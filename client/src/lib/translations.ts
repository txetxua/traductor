import { type Language } from "@shared/schema";

type TranslationCallback = (text: string, isLocal: boolean) => void;
type ErrorCallback = (error: Error) => void;

export class TranslationHandler {
  private eventSource: EventSource | null = null;
  private reconnectTimer: number | null = null;
  private isConnected = false;
  private retryCount = 0;
  private maxRetries = 3;
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
            // Mostrar el texto según el idioma seleccionado
            const isLocal = message.from === this.language;
            const text = this.language === message.to ? message.translated : message.text;

            console.log(`[Translations] Processing translation:`, {
              text,
              from: message.from,
              to: message.to,
              selectedLanguage: this.language,
              isLocal
            });

            if (isLocal) {
              this.pendingTranslations.delete(message.text);
            }

            this.onTranslation(text, isLocal);
          }
        } catch (error) {
          console.error("[Translations] Message processing error:", error);
          this.handleError(error as Error);
        }
      };

      this.eventSource.onerror = (event) => {
        console.error("[Translations] SSE Error:", event);
        this.isConnected = false;

        if (this.retryCount < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, this.retryCount), 5000);
          this.retryCount++;

          console.log(`[Translations] Reconnecting (${this.retryCount}/${this.maxRetries}) in ${delay}ms`);

          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, delay);
        } else {
          const error = new Error("No se pudo establecer la conexión para las traducciones");
          console.error("[Translations]", error);
          this.onError?.(error);
        }
      };

    } catch (error) {
      console.error("[Translations] Setup error:", error);
      this.handleError(error as Error);
    }
  }

  private handleError(error: Error) {
    console.error("[Translations] Error:", error);
    this.onError?.(error);
  }

  async translate(text: string) {
    if (!text.trim()) {
      console.log("[Translations] Empty text, skipping");
      return;
    }

    if (this.pendingTranslations.has(text)) {
      console.log("[Translations] Translation already pending for:", text);
      return;
    }

    try {
      console.log("[Translations] Requesting translation for:", text);
      console.log("[Translations] Current language:", this.language);

      this.pendingTranslations.add(text);

      // Siempre traducir al otro idioma
      const targetLanguage = this.language === "es" ? "it" : "es";

      const response = await fetch(`${this.getApiBaseUrl()}/api/translate`, {
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
        throw new Error(`Error en la traducción: ${response.status}`);
      }

      const data = await response.json();
      console.log("[Translations] Translation response:", data);
    } catch (error) {
      console.error("[Translations] Translation error:", error);
      this.pendingTranslations.delete(text);
      this.handleError(error as Error);
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
    this.pendingTranslations.clear();
  }

  stop() {
    console.log("[Translations] Stopping translation handler");
    this.cleanup();
  }
}