import { type Language } from "@shared/schema";

type TranslationCallback = (text: string, isLocal: boolean) => void;
type ErrorCallback = (error: Error) => void;

export class TranslationHandler {
  private eventSource: EventSource | null = null;

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
    // En desarrollo, usa el mismo host y puerto que el servidor Express
    const host = window.location.host.includes('localhost') || window.location.host.includes('.repl.co')
      ? window.location.host
      : window.location.host.replace('5173', '5000');
    return `${window.location.protocol}//${host}`;
  }

  private connect() {
    try {
      const baseUrl = this.getApiBaseUrl();
      const url = `${baseUrl}/api/translations/stream/${this.roomId}?language=${this.language}`;
      console.log("[Translations] Connecting to SSE:", url);

      this.eventSource = new EventSource(url);

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
        this.onError?.(new Error("SSE connection error"));
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

  stop() {
    if (this.eventSource) {
      console.log("[Translations] Closing SSE connection");
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}