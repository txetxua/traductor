import { type Language } from "@shared/schema";

type TranslationCallback = (text: string, isLocal: boolean) => void;
type ErrorCallback = (error: Error) => void;

export class TranslationHandler {
  private eventSource: EventSource | null = null;
  private reconnectTimer: number | null = null;
  private isConnected = false;
  private retryCount = 0;
  private maxRetries = 3;

  constructor(
    private roomId: string,
    private language: Language,
    private onTranslation: TranslationCallback,
    private onError?: ErrorCallback
  ) {
    console.log("[Translations] Starting for room:", roomId, "language:", language);
    this.connect();
  }

  private getApiBaseUrl(): string {
    return window.location.origin;
  }

  private connect() {
    try {
      if (this.eventSource?.readyState === EventSource.OPEN) {
        console.log("[Translations] Already connected");
        return;
      }

      this.cleanup();

      const url = new URL(`${this.getApiBaseUrl()}/api/translations/stream/${this.roomId}`);
      url.searchParams.set('language', this.language);
      console.log("[Translations] Connecting to:", url.toString());

      this.eventSource = new EventSource(url.toString());

      this.eventSource.onopen = () => {
        console.log("[Translations] SSE Connection opened");
        this.isConnected = true;
        this.retryCount = 0;
      };

      this.eventSource.onmessage = (event) => {
        try {
          console.log("[Translations] Raw message received:", event.data);
          const message = JSON.parse(event.data);
          console.log("[Translations] Parsed message:", message);

          if (message.type === "translation") {
            const isLocal = message.from === this.language;

            // For local messages, use the original text
            // For remote messages, use the translated text
            const text = isLocal ? message.text : message.translated;

            console.log(`[Translations] Processing ${isLocal ? 'local' : 'remote'} translation:`, {
              text,
              from: message.from,
              to: message.to,
              language: this.language
            });

            this.onTranslation(text, isLocal);
          }
        } catch (error) {
          console.error("[Translations] Message processing error:", error);
          this.onError?.(error as Error);
        }
      };

      this.eventSource.onerror = (event) => {
        const error = event as ErrorEvent;
        console.error("[Translations] SSE Error:", error.message);
        this.isConnected = false;

        if (this.retryCount < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, this.retryCount), 5000);
          this.retryCount++;

          console.log(`[Translations] Reconnecting (${this.retryCount}/${this.maxRetries}) in ${delay}ms`);

          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, delay);
        } else {
          const error = new Error("Failed to establish SSE connection");
          console.error("[Translations]", error);
          this.onError?.(error);
        }
      };

    } catch (error) {
      console.error("[Translations] Setup error:", error);
      this.onError?.(error as Error);
    }
  }

  async translate(text: string) {
    if (!text.trim()) {
      console.log("[Translations] Empty text, skipping");
      return;
    }

    try {
      console.log("[Translations] Requesting translation for:", text);
      console.log("[Translations] Current language:", this.language);

      const response = await fetch(`${this.getApiBaseUrl()}/api/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          from: this.language,
          to: this.language === "es" ? "it" : "es",
          roomId: this.roomId
        })
      });

      if (!response.ok) {
        throw new Error(`Translation request failed: ${response.status}`);
      }

      const data = await response.json();
      console.log("[Translations] Translation response:", data);
    } catch (error) {
      console.error("[Translations] Translation error:", error);
      this.onError?.(error as Error);
    }
  }

  private cleanup() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnected = false;
  }

  stop() {
    console.log("[Translations] Stopping translation handler");
    this.cleanup();
  }
}