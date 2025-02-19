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
  private readonly MAX_ERRORS = 15;
  private readonly ERROR_RESET_INTERVAL = 60000;
  private readonly RESTART_DELAY = 2000;
  private readonly MIN_RESTART_INTERVAL = 3000;
  private isRestarting: boolean = false;
  private isStopping: boolean = false;

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

    setInterval(() => {
      if (this.errorCount > 0) {
        console.log("[Speech] Resetting error count from", this.errorCount, "to 0");
        this.errorCount = 0;
      }
    }, this.ERROR_RESET_INTERVAL);
  }

  private setupRecognition() {
    try {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        throw new Error("El reconocimiento de voz no está soportado en este navegador. Intente usar Chrome.");
      }

      this.cleanup();

      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      this.recognition = new SpeechRecognition();
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
        this.isRestarting = false;
        this.isStopping = false;
        this.lastRestartTime = Date.now();
      };

      this.recognition.onend = () => {
        console.log("[Speech] Recognition ended");

        if (this.isStopping) {
          console.log("[Speech] Not restarting - stopped intentionally");
          return;
        }

        if (this.isRestarting) {
          console.log("[Speech] Already restarting - skipping additional restart");
          return;
        }

        if (this.errorCount < this.MAX_ERRORS) {
          const timeSinceLastRestart = Date.now() - this.lastRestartTime;
          const delayBeforeRestart = Math.max(
            this.RESTART_DELAY,
            this.MIN_RESTART_INTERVAL - timeSinceLastRestart
          );

          console.log(`[Speech] Scheduling restart in ${delayBeforeRestart}ms`);

          if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
          }

          this.isRestarting = true;
          this.restartTimeout = window.setTimeout(() => {
            console.log("[Speech] Restarting recognition");
            this.restart();
          }, delayBeforeRestart) as unknown as number;
        } else {
          console.log("[Speech] Too many errors, stopping recognition");
          this.stop();
          this.onError?.(new Error("El reconocimiento de voz se ha detenido debido a errores repetidos. Por favor, actualice la página para intentar nuevamente."));
        }
      };

      this.recognition.onerror = (event) => {
        console.log("[Speech] Recognition error:", event.error);

        if (event.error === 'aborted') {
          if (this.isRestarting || this.isStopping) {
            console.log("[Speech] Ignoring aborted error during restart/stop");
            return;
          }
          // Si no estamos reiniciando o deteniendo, iniciar un nuevo ciclo
          this.restart();
          return;
        }

        if (!this.isStarted || event.error === 'no-speech' || event.error === 'audio-capture') {
          console.log("[Speech] Ignoring expected error:", event.error);
          return;
        }

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
          default:
            errorMessage = `Error en el reconocimiento de voz: ${event.error}`;
        }

        this.errorCount++;
        console.log(`[Speech] Error ${this.errorCount}/${this.MAX_ERRORS}:`, errorMessage);
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

            this.onTranscript(text, true);

            if (this.errorCount > 0) {
              this.errorCount = Math.max(0, this.errorCount - 1);
            }

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
  }

  private handleError(error: Error) {
    console.error("[Speech] Error:", error.message);
    this.onError?.(error);
  }

  private restart() {
    try {
      this.cleanup();
      this.setupRecognition();
      if (this.recognition && !this.isStopping) {
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
    this.isStopping = false;

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
    this.isRestarting = false;
    this.isStopping = true;

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