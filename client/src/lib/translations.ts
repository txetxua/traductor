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

      const url = `${this.getApiBaseUrl()}/api/translations/stream/${this.roomId}?language=${this.language}`;
      console.log("[Translations] Connecting to:", url);

      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        console.log("[Translations] Connected");
        this.isConnected = true;
        this.retryCount = 0;
      };

      this.eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("[Translations] Message received:", message);

          if (message.type === "translation") {
            // Si el mensaje es en nuestro idioma, lo mostramos como transcripción local
            // Si la traducción es a nuestro idioma, la mostramos como transcripción remota
            const isLocal = message.from === this.language;
            const text = isLocal ? message.text : message.translated;

            console.log(`[Translations] Showing ${isLocal ? 'local' : 'remote'} transcript:`, text);
            this.onTranslation(text, isLocal);
          }
        } catch (error) {
          console.error("[Translations] Message processing error:", error);
          this.onError?.(error as Error);
        }
      };

      this.eventSource.onerror = () => {
        console.error("[Translations] Connection error");
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
          const error = new Error("Failed to establish translation connection");
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
      console.log("[Translations] Translation successful:", data);
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
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnected = false;
  }

  stop() {
    console.log("[Translations] Stopping");
    this.cleanup();
  }
}