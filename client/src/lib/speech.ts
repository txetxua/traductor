import { type Language } from "@shared/schema";
import { TranslationHandler } from "./translations";

type TranscriptCallback = (text: string, isLocal: boolean) => void;
type ErrorCallback = (error: Error) => void;

export class SpeechHandler {
  private recognition?: SpeechRecognition;
  private translationHandler: TranslationHandler;
  private isStarted: boolean = false;
  private restartTimeout?: number;

  constructor(
    private roomId: string,
    private language: Language,
    private onTranscript: TranscriptCallback,
    private onError?: ErrorCallback
  ) {
    console.log("[Speech] Initializing for room:", roomId, "language:", language);
    this.translationHandler = new TranslationHandler(
      roomId,
      language,
      onTranscript,
      onError
    );
  }

  private setupRecognition() {
    try {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        throw new Error("El reconocimiento de voz no está soportado en este navegador. Intente usar Chrome.");
      }

      this.cleanup();

      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      this.recognition = new SpeechRecognition();

      // Configuración básica
      this.recognition.continuous = true;
      this.recognition.interimResults = true;

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

        // Reiniciar solo si estamos activos
        if (this.isStarted) {
          console.log("[Speech] Scheduling restart in 2000ms");

          if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
          }

          this.restartTimeout = window.setTimeout(() => {
            console.log("[Speech] Restarting recognition");
            this.restart();
          }, 2000) as unknown as number;
        }
      };

      this.recognition.onerror = (event) => {
        console.log("[Speech] Recognition error:", event.error);

        if (!this.isStarted || event.error === 'no-speech' || event.error === 'audio-capture') {
          console.log("[Speech] Ignoring expected error");
          return;
        }

        if (event.error === 'aborted') {
          // Si se abortó, simplemente reiniciamos
          this.restart();
          return;
        }

        // Solo notificamos errores reales
        const errorMessage = event.error === 'network' 
          ? "Error de red. Por favor, verifique su conexión."
          : event.error === 'not-allowed'
          ? "Acceso al micrófono denegado. Por favor, permita el acceso en la configuración del navegador."
          : `Error en el reconocimiento de voz: ${event.error}`;

        this.onError?.(new Error(errorMessage));
      };

      this.recognition.onresult = async (event: SpeechRecognitionEvent) => {
        try {
          const result = event.results[event.results.length - 1];

          if (result.isFinal) {
            const text = result[0].transcript.trim();
            console.log("[Speech] Final text recognized:", text);

            if (!text) {
              console.log("[Speech] Empty text, ignoring");
              return;
            }

            // Enviar el texto local y la traducción
            this.onTranscript(text, true);
            await this.translationHandler.translate(text);
          }
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

  private cleanup() {
    if (this.recognition) {
      console.log("[Speech] Cleaning up existing recognition instance");
      this.recognition.onend = null;
      this.recognition.onerror = null;
      this.recognition.onresult = null;
      try {
        this.recognition.abort();
      } catch (error) {
        console.log("[Speech] Error during cleanup:", error);
      }
      this.recognition = undefined;
    }

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = undefined;
    }
  }

  private restart() {
    try {
      this.cleanup();
      this.setupRecognition();
      if (this.recognition && this.isStarted) {
        this.recognition.start();
      }
    } catch (error) {
      console.error("[Speech] Error during restart:", error);
      this.onError?.(error as Error);
    }
  }

  start() {
    if (!this.recognition) {
      this.setupRecognition();
    }

    this.isStarted = true;

    try {
      console.log("[Speech] Starting recognition for language:", this.language);
      this.recognition?.start();
    } catch (error) {
      if (error instanceof Error && error.message.includes('already started')) {
        console.log("[Speech] Recognition already started, restarting");
        this.restart();
      } else {
        console.error("[Speech] Error starting recognition:", error);
        this.onError?.(error as Error);
      }
    }
  }

  stop() {
    console.log("[Speech] Stopping recognition");
    this.isStarted = false;

    this.cleanup();
    this.translationHandler.stop();
  }
}