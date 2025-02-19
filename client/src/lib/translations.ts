import { type Language } from "@shared/schema";

type TranslationCallback = (text: string, isLocal: boolean) => void;
type ErrorCallback = (error: Error) => void;

export class TranslationHandler {
  private eventSource: EventSource | null = null;
  private pendingTranslations = new Set<string>();

  constructor(
    private roomId: string,
    private language: Language,
    private onTranslation: TranslationCallback,
    private onError?: ErrorCallback
  ) {
    console.log("[Translations] Starting for room:", roomId, "language:", language);
    this.connect();
  }

  private connect() {
    try {
      this.cleanup();

      // Usar la URL actual para el SSE
      const sseUrl = new URL(`${window.location.origin}/api/translations/stream/${this.roomId}`);
      sseUrl.searchParams.set('language', this.language);

      console.log("[Translations] Connecting to:", sseUrl.toString());
      this.eventSource = new EventSource(sseUrl.toString());

      this.eventSource.onmessage = (event) => {
        try {
          console.log("[Translations] Message received:", event.data);
          const message = JSON.parse(event.data);

          if (message.type === 'translation') {
            const isLocal = message.from === this.language;
            const text = this.language === message.to ? message.translated : message.text;

            console.log("[Translations] Processing:", {
              text,
              from: message.from,
              to: message.to,
              selectedLanguage: this.language,
              isLocal
            });

            this.onTranslation(text, isLocal);
          }
        } catch (error) {
          console.error("[Translations] Message processing error:", error);
          this.onError?.(error as Error);
        }
      };

      this.eventSource.onerror = (error) => {
        console.error("[Translations] SSE error:", error);
        this.onError?.(new Error("Error en la conexión de traducciones"));
      };

    } catch (error) {
      console.error("[Translations] Setup error:", error);
      this.onError?.(error as Error);
    }
  }

  async translate(text: string) {
    if (!text.trim()) return;

    try {
      console.log("[Translations] Translating:", text);

      const targetLanguage = this.language === "es" ? "it" : "es";

      const response = await fetch(`/api/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          from: this.language,
          to: targetLanguage,
          roomId: this.roomId
        })
      });

      if (!response.ok) {
        throw new Error(`Error de traducción: ${response.status}`);
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
  }

  stop() {
    console.log("[Translations] Stopping");
    this.cleanup();
  }
}