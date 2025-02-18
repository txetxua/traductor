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
  private readonly MAX_ERRORS = 3;
  private readonly ERROR_RESET_INTERVAL = 10000; // 10 seconds

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
    this.setupRecognition();
  }

  private setupRecognition() {
    try {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        throw new Error("Speech recognition is not supported in this browser. Try using Chrome.");
      }

      // Initialize recognition with proper fallback
      this.recognition = new (window.webkitSpeechRecognition || window.SpeechRecognition)();

      // Configure recognition settings
      this.recognition.continuous = true;
      this.recognition.interimResults = true;

      // Set language based on the selected language
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
          this.errorCount = 0;
        }
      }, this.ERROR_RESET_INTERVAL);

      // Event handlers
      this.recognition.onstart = () => {
        console.log("[Speech] Recognition started for language:", this.language);
        this.isStarted = true;
      };

      this.recognition.onend = () => {
        console.log("[Speech] Recognition ended");

        // Only restart if we're still active and haven't hit error limit
        if (this.isStarted && this.errorCount < this.MAX_ERRORS) {
          console.log("[Speech] Scheduling restart");
          this.restartTimeout = window.setTimeout(() => {
            if (this.isStarted) {
              console.log("[Speech] Restarting recognition");
              try {
                this.recognition?.start();
              } catch (error) {
                console.error("[Speech] Error restarting recognition:", error);
                this.handleError(error as Error);
              }
            }
          }, 1000) as unknown as number;
        } else if (this.errorCount >= this.MAX_ERRORS) {
          console.log("[Speech] Too many errors, stopping recognition");
          this.stop();
          this.onError?.(new Error("Speech recognition stopped due to too many errors"));
        }
      };

      this.recognition.onerror = (event) => {
        console.error("[Speech] Recognition error:", event.error, event.message);

        // Don't count no-speech as an error
        if (event.error === 'no-speech') {
          console.log("[Speech] No speech detected");
          return;
        }

        // Handle specific errors
        if (event.error === 'audio-capture') {
          this.handleError(new Error("No microphone was found or microphone is disabled"));
          return;
        }

        if (event.error === 'not-allowed') {
          this.handleError(new Error("Microphone access was not allowed"));
          return;
        }

        if (event.error === 'network') {
          this.handleError(new Error("Network error occurred during speech recognition"));
          return;
        }

        if (event.error === 'aborted') {
          // Don't count aborted as an error if we're stopping intentionally
          if (this.isStarted) {
            this.handleError(new Error("Speech recognition was aborted"));
          }
          return;
        }

        this.handleError(new Error(`Speech recognition error: ${event.error}`));
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

  start() {
    if (!this.recognition) {
      console.error("[Speech] Recognition not initialized");
      return;
    }

    this.errorCount = 0;
    if (!this.isStarted) {
      try {
        console.log("[Speech] Starting recognition for language:", this.language);
        this.recognition.start();
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