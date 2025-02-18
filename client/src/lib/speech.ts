import { type Language, type TranslationMessage } from "@shared/schema";
import { WebSocketHandler } from "./websocket";

export class SpeechHandler {
  private recognition?: any;
  private wsHandler: WebSocketHandler;
  private isStarted: boolean = false;

  constructor(
    private roomId: string,
    private language: Language,
    private onTranscript: (text: string, isLocal: boolean) => void,
    private onError?: (error: Error) => void
  ) {
    console.log("[Speech] Iniciando para sala:", roomId, "idioma:", language);

    // Inicializar WebSocketHandler
    this.wsHandler = new WebSocketHandler(roomId, onError);

    // Configurar manejadores de mensajes
    this.wsHandler.onMessage("error", (message) => {
      console.error("[Speech] Error del servidor:", message.error);
      this.onError?.(new Error(message.error));
    });

    this.wsHandler.onMessage("joined", (message) => {
      console.log("[Speech] Unido a sala:", message.roomId);
    });

    this.wsHandler.onMessage("translation", (message) => {
      const translationMsg = message as TranslationMessage;
      console.log("[Speech] Traducción recibida:", translationMsg);

      // Solo mostrar traducciones de otros participantes
      if (translationMsg.from !== this.language) {
        console.log("[Speech] Mostrando traducción:", translationMsg.translated);
        this.onTranscript(translationMsg.translated, false);
      } else {
        console.log("[Speech] Ignorando traducción local");
      }
    });

    // Iniciar conexión y reconocimiento
    this.wsHandler.connect();
    this.setupRecognition();
  }

  private setupRecognition() {
    if (!("webkitSpeechRecognition" in window)) {
      this.onError?.(new Error("Reconocimiento de voz no soportado"));
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
        console.log("[Speech] Reconocimiento iniciado");
        this.isStarted = true;
      };

      this.recognition.onend = () => {
        console.log("[Speech] Reconocimiento terminado");
        if (this.isStarted) {
          console.log("[Speech] Reiniciando reconocimiento");
          try {
            this.recognition.start();
          } catch (error) {
            console.error("[Speech] Error reiniciando reconocimiento:", error);
          }
        }
      };

      this.recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') return;
        console.error("[Speech] Error de reconocimiento:", event.error);
        this.onError?.(new Error(`Error en reconocimiento de voz: ${event.error}`));
      };

      this.recognition.onresult = async (event: any) => {
        try {
          const text = event.results[event.results.length - 1][0].transcript;
          console.log("[Speech] Texto reconocido:", text);

          if (!text.trim()) {
            console.log("[Speech] Texto vacío, ignorando");
            return;
          }

          // Obtener traducción
          const response = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              from: this.language,
              to: this.language === "es" ? "it" : "es"
            })
          });

          if (!response.ok) {
            throw new Error(`Error de traducción: ${response.status}`);
          }

          const { translated } = await response.json();
          console.log(`[Speech] Texto traducido: "${text}" -> "${translated}"`);

          // Enviar traducción por WebSocket
          if (this.wsHandler.isOpen()) {
            const message: TranslationMessage = {
              type: "translation",
              text,
              from: this.language,
              translated
            };
            console.log("[Speech] Enviando traducción:", message);
            this.wsHandler.send(message);
          } else {
            console.error("[Speech] WebSocket no está listo");
            this.wsHandler.connect();
          }
        } catch (error) {
          console.error("[Speech] Error:", error);
          this.onError?.(error as Error);
        }
      };
    } catch (error) {
      console.error("[Speech] Error configurando reconocimiento:", error);
      this.onError?.(error as Error);
    }
  }

  start() {
    if (this.recognition && !this.isStarted) {
      try {
        this.recognition.start();
      } catch (error) {
        console.error("[Speech] Error iniciando:", error);
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
        console.error("[Speech] Error deteniendo:", error);
      }
    }

    this.wsHandler.close();
  }
}