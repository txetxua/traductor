import { type Language } from "@shared/schema";
import { TranslationHandler } from "./translations";

type TranscriptCallback = (text: string, isLocal: boolean) => void;
type ErrorCallback = (error: Error) => void;

interface SpeechEngine {
  isSupported(): boolean;
  start(): void;
  stop(): void;
  setLanguage(lang: string): void;
}

class WebSpeechEngine implements SpeechEngine {
  private recognition?: SpeechRecognition;
  private isStarted: boolean = false;
  private restartTimeout?: number;

  constructor(
    private language: string,
    private onResult: (text: string) => void,
    private onError: (error: Error) => void
  ) {
    this.setupRecognition();
  }

  isSupported(): boolean {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }

  private setupRecognition() {
    try {
      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      this.recognition = new SpeechRecognition();

      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = this.language;

      this.recognition.onstart = () => {
        console.log("[WebSpeech] Recognition started for language:", this.language);
        this.isStarted = true;
      };

      this.recognition.onend = () => {
        console.log("[WebSpeech] Recognition ended");
        if (this.isStarted) {
          this.scheduleRestart();
        }
      };

      this.recognition.onerror = (event) => {
        console.log("[WebSpeech] Recognition error:", event.error);

        if (!this.isStarted || event.error === 'no-speech' || event.error === 'audio-capture') {
          return;
        }

        if (event.error === 'aborted') {
          this.restart();
          return;
        }

        const errorMessage = this.getErrorMessage(event.error);
        this.onError(new Error(errorMessage));
      };

      this.recognition.onresult = (event) => {
        const result = event.results[event.results.length - 1];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) {
            this.onResult(text);
          }
        }
      };

    } catch (error) {
      console.error("[WebSpeech] Setup error:", error);
      this.onError(error as Error);
    }
  }

  private getErrorMessage(error: string): string {
    switch (error) {
      case 'network':
        return "Error de red. Por favor, verifique su conexión.";
      case 'not-allowed':
        return "Acceso al micrófono denegado. Por favor, permita el acceso en la configuración del navegador.";
      default:
        return `Error en el reconocimiento de voz: ${error}`;
    }
  }

  private scheduleRestart() {
    console.log("[WebSpeech] Scheduling restart in 2000ms");
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }
    this.restartTimeout = window.setTimeout(() => this.restart(), 2000);
  }

  private restart() {
    this.cleanup();
    this.setupRecognition();
    if (this.isStarted) {
      this.start();
    }
  }

  private cleanup() {
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onerror = null;
      this.recognition.onresult = null;
      try {
        this.recognition.abort();
      } catch (error) {
        console.log("[WebSpeech] Cleanup error:", error);
      }
      this.recognition = undefined;
    }
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = undefined;
    }
  }

  start() {
    if (!this.recognition) {
      this.setupRecognition();
    }
    this.isStarted = true;
    try {
      this.recognition?.start();
    } catch (error) {
      console.error("[WebSpeech] Start error:", error);
      this.onError(error as Error);
    }
  }

  stop() {
    this.isStarted = false;
    this.cleanup();
  }

  setLanguage(lang: string) {
    if (this.recognition) {
      this.language = lang;
      this.recognition.lang = lang;
    }
  }
}

export class SpeechHandler {
  private engines: SpeechEngine[] = [];
  private currentEngine?: SpeechEngine;
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

    // Registrar motores de reconocimiento de voz en orden de preferencia
    this.registerEngines();
    this.selectEngine();
  }

  private registerEngines() {
    // Web Speech API
    const webSpeech = new WebSpeechEngine(
      this.getLanguageCode(),
      async (text) => {
        console.log("[Speech] Text recognized:", text, "Language:", this.language);
        this.onTranscript(text, true);
        await this.translationHandler.translate(text);
      },
      (error) => {
        console.error("[Speech] Engine error:", error);
        if (this.currentEngine === webSpeech) {
          this.fallbackToNextEngine();
        }
      }
    );
    this.engines.push(webSpeech);

    // Aquí se pueden registrar más motores de reconocimiento
    // Por ejemplo: Azure Speech, Google Speech-to-Text, etc.
  }

  private selectEngine() {
    for (const engine of this.engines) {
      if (engine.isSupported()) {
        console.log("[Speech] Selected engine:", engine.constructor.name);
        this.currentEngine = engine;
        return;
      }
    }
    this.onError?.(new Error("No hay motores de reconocimiento de voz disponibles"));
  }

  private fallbackToNextEngine() {
    const currentIndex = this.engines.indexOf(this.currentEngine!);
    for (let i = currentIndex + 1; i < this.engines.length; i++) {
      const engine = this.engines[i];
      if (engine.isSupported()) {
        console.log("[Speech] Falling back to engine:", engine.constructor.name);
        this.currentEngine?.stop();
        this.currentEngine = engine;
        if (this.isStarted) {
          this.currentEngine.start();
        }
        return;
      }
    }
    this.onError?.(new Error("No hay más motores de reconocimiento disponibles"));
  }

  private getLanguageCode(): string {
    const langMap: Record<Language, string> = {
      es: "es-ES",
      it: "it-IT"
    };
    return langMap[this.language];
  }

  start() {
    if (!this.currentEngine) {
      this.selectEngine();
    }

    if (!this.currentEngine) {
      this.onError?.(new Error("No hay motores de reconocimiento disponibles"));
      return;
    }

    console.log("[Speech] Starting recognition for language:", this.language);
    this.isStarted = true;
    this.currentEngine.start();
  }

  stop() {
    console.log("[Speech] Stopping recognition");
    this.isStarted = false;
    this.currentEngine?.stop();
    this.translationHandler.stop();
  }
}