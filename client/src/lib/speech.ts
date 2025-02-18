import { type Language } from "@shared/schema";
import { TranslationHandler } from "./translations";

export class SpeechHandler {
  private recognition?: SpeechRecognition;
  private translationHandler: TranslationHandler;
  private isStarted: boolean = false;

  constructor(
    private roomId: string,
    private language: Language,
    private onTranscript: (text: string, isLocal: boolean) => void,
    private onError?: (error: Error) => void
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
    // Check for browser support
    if (!('webkitSpeechRecognition' in window)) {
      this.onError?.(new Error("Speech recognition is not supported in this browser"));
      return;
    }

    try {
      // @ts-ignore - webkitSpeechRecognition is not in types
      this.recognition = new webkitSpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;

      // Improved language mapping for speech recognition
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
        // Only restart if we're still active
        if (this.isStarted) {
          console.log("[Speech] Restarting recognition");
          try {
            this.recognition?.start();
          } catch (error) {
            console.error("[Speech] Error restarting recognition:", error);
            this.onError?.(error as Error);
          }
        }
      };

      this.recognition.onerror = (event: any) => {
        // Ignore no-speech errors as they're common during silences
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

          // Show local transcription immediately
          this.onTranscript(text, true);

          // Send for translation
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