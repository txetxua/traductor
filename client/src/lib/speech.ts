import { type Language } from "@shared/schema";
import { TranslationHandler } from "./translations";

export class SpeechHandler {
  private recognition?: any;
  private translationHandler: TranslationHandler;
  private isStarted: boolean = false;

  constructor(
    private roomId: string,
    private language: Language,
    private onTranscript: (text: string, isLocal: boolean) => void,
    private onError?: (error: Error) => void
  ) {
    console.log("[Speech] Starting for room:", roomId, "language:", language);

    this.translationHandler = new TranslationHandler(
      roomId,
      language,
      onTranscript,
      onError
    );

    this.setupRecognition();
  }

  private setupRecognition() {
    if (!("webkitSpeechRecognition" in window)) {
      this.onError?.(new Error("Speech recognition not supported"));
      return;
    }

    try {
      this.recognition = new (window as any).webkitSpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;

      // Mapeo mejorado de idiomas para el reconocimiento de voz
      const langMap: Record<Language, string> = {
        es: "es-ES",
        it: "it-IT"
      };

      console.log("[Speech] Setting language to:", langMap[this.language]);
      this.recognition.lang = langMap[this.language];

      this.recognition.onstart = () => {
        console.log("[Speech] Recognition started for language:", this.language);
        this.isStarted = true;
      };

      this.recognition.onend = () => {
        console.log("[Speech] Recognition ended");
        // Solo reiniciar si todavía estamos activos
        if (this.isStarted) {
          console.log("[Speech] Restarting recognition");
          try {
            this.recognition.start();
          } catch (error) {
            console.error("[Speech] Error restarting recognition:", error);
            this.onError?.(error as Error);
          }
        }
      };

      this.recognition.onerror = (event: any) => {
        // Ignorar errores de "no-speech" ya que son comunes durante silencios
        if (event.error === 'no-speech') {
          console.log("[Speech] No speech detected");
          return;
        }

        console.error("[Speech] Recognition error:", event.error);
        this.onError?.(new Error(`Speech recognition error: ${event.error}`));
      };

      this.recognition.onresult = async (event: any) => {
        try {
          const text = event.results[event.results.length - 1][0].transcript;
          console.log("[Speech] Text recognized:", text, "Language:", this.language);

          if (!text.trim()) {
            console.log("[Speech] Empty text, ignoring");
            return;
          }

          // Mostrar transcripción local inmediatamente
          this.onTranscript(text, true);

          // Enviar para traducción
          await this.translationHandler.translate(text);
        } catch (error) {
          console.error("[Speech] Error processing speech result:", error);
          this.onError?.(error as Error);
        }
      };
    } catch (error) {
      console.error("[Speech] Error setting up recognition:", error);
      this.onError?.(error as Error);
    }
  }

  start() {
    if (!this.recognition) {
      console.error("[Speech] Recognition not initialized");
      return;
    }

    if (!this.isStarted) {
      try {
        console.log("[Speech] Starting recognition for language:", this.language);
        this.recognition.start();
      } catch (error) {
        console.error("[Speech] Error starting recognition:", error);
        this.onError?.(error as Error);
      }
    } else {
      console.log("[Speech] Recognition already started");
    }
  }

  stop() {
    console.log("[Speech] Stopping recognition");
    this.isStarted = false;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (error) {
        console.error("[Speech] Error stopping recognition:", error);
      }
    }

    this.translationHandler.stop();
  }
}