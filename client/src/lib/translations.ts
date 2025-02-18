import { type Language } from "@shared/schema";

type TranslationCallback = (text: string, isLocal: boolean) => void;
type ErrorCallback = (error: Error) => void;

export class TranslationHandler {
  private eventSource: EventSource | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 2000;

  constructor(
    private roomId: string,
    private language: Language,
    private onTranslation: TranslationCallback,
    private onError?: ErrorCallback
  ) {
    console.log("[Translations] Starting for room:", roomId, "language:", language);
    this.connect();
  }

  private getApiBaseUrl() {
    return window.location.origin;
  }

  private connect() {
    try {
      if (this.eventSource?.readyState === EventSource.OPEN) {
        console.log("[Translations] Connection already active");
        return;
      }

      // Cleanup existing connection if any
      this.cleanup();

      const baseUrl = this.getApiBaseUrl();
      const url = `${baseUrl}/api/translations/stream/${this.roomId}?language=${this.language}`;
      console.log("[Translations] Connecting to SSE:", url);

      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        console.log("[Translations] Connection established");
        this.isConnected = true;
        this.reconnectAttempts = 0;
      };

      this.eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("[Translations] Message received:", message);

          if (message.type === "translation" && message.to === this.language) {
            console.log("[Translations] Showing translation:", message.translated);
            this.onTranslation(message.translated, false);
          }
        } catch (error) {
          console.error("[Translations] Error processing message:", error);
          this.onError?.(error as Error);
        }
      };

      this.eventSource.onerror = () => {
        console.error("[Translations] SSE connection error");
        this.isConnected = false;

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          if (!this.reconnectTimeout) {
            this.reconnectTimeout = setTimeout(() => {
              this.reconnectTimeout = null;
              this.reconnectAttempts++;
              console.log(`[Translations] Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
              this.connect();
            }, this.reconnectDelay);
          }
        } else {
          this.onError?.(new Error("Failed to establish SSE connection after maximum attempts"));
        }
      };

    } catch (error) {
      console.error("[Translations] Error connecting:", error);
      this.onError?.(error as Error);
    }
  }

  async translate(text: string) {
    try {
      const baseUrl = this.getApiBaseUrl();
      console.log("[Translations] Translating text:", text);

      const response = await fetch(`${baseUrl}/api/translate`, {
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
        throw new Error(`Translation error: ${response.status}`);
      }

      const { translated } = await response.json();
      console.log("[Translations] Text translated:", translated);

      // Show local transcription
      this.onTranslation(text, true);
    } catch (error) {
      console.error("[Translations] Error:", error);
      this.onError?.(error as Error);
    }
  }

  private cleanup() {
    if (this.eventSource) {
      console.log("[Translations] Cleaning up existing connection");
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.isConnected = false;
  }

  stop() {
    console.log("[Translations] Stopping translation handler");
    this.cleanup();
  }
}