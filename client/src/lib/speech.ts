import { type Language } from "@shared/schema";
import { TranslationHandler } from "./translations";

type TranscriptCallback = (text: string, isLocal: boolean) => void;
type ErrorCallback = (error: Error) => void;

export class SpeechHandler {
  private recognition?: SpeechRecognition;
  private translationHandler: TranslationHandler;
  private isStarted: boolean = false;
  private restartTimeout?: number;
  private errorCount: number = 0;
  private lastRestartTime: number = 0;
  private readonly MAX_ERRORS = 10; // Increased to allow more retries
  private readonly ERROR_RESET_INTERVAL = 120000; // 2 minutes
  private readonly RESTART_DELAY = 3000; // 3 seconds
  private readonly MIN_RESTART_INTERVAL = 10000; // 10 seconds between restarts

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
        throw new Error("Speech recognition is not supported in this browser. Try using Chrome.");
      }

      // Clean up existing recognition instance
      if (this.recognition) {
        this.recognition.onend = null;
        this.recognition.onerror = null;
        this.recognition.onresult = null;
        this.recognition.abort();
      }

      this.recognition = new (window.webkitSpeechRecognition || window.SpeechRecognition)();
      this.recognition.continuous = true;
      this.recognition.interimResults = false; // Changed to false to reduce processing load

      const langMap: Record<Language, string> = {
        es: "es-ES",
        it: "it-IT"
      };

      console.log("[Speech] Setting language to:", langMap[this.language]);
      this.recognition.lang = langMap[this.language];

      // Reset error count periodically
      setInterval(() => {
        if (this.errorCount > 0) {
          console.log("[Speech] Resetting error count");
          this.errorCount = Math.max(0, this.errorCount - 1); // Gradually reduce errors
        }
      }, this.ERROR_RESET_INTERVAL);

      this.recognition.onstart = () => {
        console.log("[Speech] Recognition started for language:", this.language);
        this.isStarted = true;
        this.lastRestartTime = Date.now();
      };

      this.recognition.onend = () => {
        console.log("[Speech] Recognition ended");

        if (this.isStarted && this.errorCount < this.MAX_ERRORS) {
          const timeSinceLastRestart = Date.now() - this.lastRestartTime;
          const delayBeforeRestart = Math.max(
            this.RESTART_DELAY,
            this.MIN_RESTART_INTERVAL - timeSinceLastRestart
          );

          console.log("[Speech] Scheduling restart in", delayBeforeRestart, "ms");
          if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
          }

          this.restartTimeout = window.setTimeout(() => {
            if (this.isStarted) {
              console.log("[Speech] Restarting recognition");
              this.restart();
            }
          }, delayBeforeRestart) as unknown as number;
        } else if (this.errorCount >= this.MAX_ERRORS) {
          console.log("[Speech] Too many errors, stopping recognition");
          this.stop();
          this.onError?.(new Error("El reconocimiento de voz se ha detenido debido a errores repetidos. Por favor, actualice la página para intentar nuevamente."));
        }
      };

      this.recognition.onerror = (event) => {
        console.log("[Speech] Recognition error:", event.error, event.message);

        // Don't count these as errors
        if (event.error === 'no-speech' || 
            event.error === 'audio-capture' ||
            (event.error === 'aborted' && !this.isStarted)) {
          console.log("[Speech] Ignoring non-critical error");
          return;
        }

        // Map specific errors to user-friendly messages
        let errorMessage: string;
        switch (event.error) {
          case 'network':
            errorMessage = "Error de red. Por favor, verifique su conexión.";
            break;
          case 'not-allowed':
            errorMessage = "Acceso al micrófono denegado. Por favor, permita el acceso en la configuración del navegador.";
            break;
          case 'service-not-allowed':
            errorMessage = "El servicio de reconocimiento de voz no está disponible. Por favor, intente más tarde.";
            break;
          case 'aborted':
            errorMessage = "El reconocimiento de voz se interrumpió. Reiniciando...";
            break;
          default:
            errorMessage = `Error en el reconocimiento de voz: ${event.error}`;
        }

        this.handleError(new Error(errorMessage));
      };

      this.recognition.onresult = async (event: SpeechRecognitionEvent) => {
        try {
          const result = event.results[event.results.length - 1];
          if (result.isFinal) {
            const text = result[0].transcript.trim();
            console.log("[Speech] Text recognized:", text, "Language:", this.language);

            if (!text) {
              console.log("[Speech] Empty text, ignoring");
              return;
            }

            // Show local transcription immediately
            console.log("[Speech] Sending local transcript");
            this.onTranscript(text, true);

            // Reset error count on successful recognition
            if (this.errorCount > 0) {
              this.errorCount = Math.max(0, this.errorCount - 1);
            }

            // Send for translation
            console.log("[Speech] Requesting translation");
            await this.translationHandler.translate(text);
          }
        } catch (error) {
          console.error("[Speech] Error processing speech result:", error);
          this.handleError(error as Error);
        }
      };

    } catch (error) {
      console.error("[Speech] Error setting up recognition:", error);
      this.handleError(error as Error);
    }
  }

  private handleError(error: Error) {
    this.errorCount++;
    console.error(`[Speech] Error ${this.errorCount}/${this.MAX_ERRORS}:`, error.message);
    this.onError?.(error);
  }

  private restart() {
    try {
      this.setupRecognition();
      if (this.recognition && this.isStarted) {
        this.recognition.start();
      }
    } catch (error) {
      console.error("[Speech] Error during restart:", error);
      this.handleError(error as Error);
    }
  }

  start() {
    if (!this.recognition) {
      this.setupRecognition();
    }

    this.errorCount = 0;
    if (!this.isStarted) {
      try {
        console.log("[Speech] Starting recognition for language:", this.language);
        this.recognition?.start();
      } catch (error) {
        console.error("[Speech] Error starting recognition:", error);
        this.handleError(error as Error);
      }
    } else {
      console.log("[Speech] Recognition already started");
    }
  }

  stop() {
    console.log("[Speech] Stopping recognition");
    this.isStarted = false;

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = undefined;
    }

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