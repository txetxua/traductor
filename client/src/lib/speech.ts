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

      const langMap = {
        es: "es-ES",
        it: "it-IT"
      };
      this.recognition.lang = langMap[this.language];

      this.recognition.onstart = () => {
        console.log("[Speech] Recognition started");
        this.isStarted = true;
      };

      this.recognition.onend = () => {
        console.log("[Speech] Recognition ended");
        if (this.isStarted) {
          console.log("[Speech] Restarting recognition");
          try {
            this.recognition.start();
          } catch (error) {
            console.error("[Speech] Error restarting recognition:", error);
          }
        }
      };

      this.recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') return;
        console.error("[Speech] Recognition error:", event.error);
        this.onError?.(new Error(`Speech recognition error: ${event.error}`));
      };

      this.recognition.onresult = async (event: any) => {
        try {
          const text = event.results[event.results.length - 1][0].transcript;
          console.log("[Speech] Text recognized:", text);

          if (!text.trim()) {
            console.log("[Speech] Empty text, ignoring");
            return;
          }

          await this.translationHandler.translate(text);
        } catch (error) {
          console.error("[Speech] Error:", error);
          this.onError?.(error as Error);
        }
      };
    } catch (error) {
      console.error("[Speech] Error setting up recognition:", error);
      this.onError?.(error as Error);
    }
  }

  start() {
    if (this.recognition && !this.isStarted) {
      try {
        this.recognition.start();
      } catch (error) {
        console.error("[Speech] Error starting:", error);
        this.onError?.(error as Error);
      }
    }
  }

  stop() {
    this.isStarted = false;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (error) {
        console.error("[Speech] Error stopping:", error);
      }
    }

    this.translationHandler.stop();
  }
}