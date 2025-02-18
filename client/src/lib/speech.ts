import { type Language } from "@shared/schema";
import { TranslationHandler } from "./translations";

type TranscriptCallback = (text: string, isLocal: boolean) => void;
type ErrorCallback = (error: Error) => void;

export class SpeechHandler {
  private recognition?: SpeechRecognition;
  private translationHandler: TranslationHandler;
  private isStarted: boolean = false;

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
      // Check for browser support
      if (!('webkitSpeechRecognition' in window)) {
        throw new Error("Speech recognition is not supported in this browser. Try using Chrome.");
      }

      // Initialize recognition
      this.recognition = new webkitSpeechRecognition();

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

      // Event handlers
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

      this.recognition.onerror = (event) => {
        if (event.error === 'no-speech') {
          console.log("[Speech] No speech detected");
          return;
        }

        console.error("[Speech] Recognition error:", event.error, event.message);
        this.onError?.(new Error(`Speech recognition error: ${event.error}`));
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