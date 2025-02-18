import { type Language, type TranslationMessage } from "@shared/schema";

declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

export class SpeechHandler {
  private recognition?: any;
  private ws!: WebSocket;
  private isStarted: boolean = false;

  constructor(
    private roomId: string,
    private language: Language,
    private onTranscript: (text: string, translated: string) => void
  ) {
    this.initializeWebSocket();
    this.setupRecognition();
  }

  private initializeWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("[Speech] WebSocket conectado");
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "translation") {
          const translationMsg = message as TranslationMessage;
          if (translationMsg.from !== this.language) {
            console.log("[Speech] Traducción recibida:", translationMsg);
            this.onTranscript(translationMsg.text, translationMsg.translated);
          }
        }
      } catch (error) {
        console.error("[Speech] Error procesando mensaje:", error);
      }
    };
  }

  private setupRecognition() {
    if (!("webkitSpeechRecognition" in window)) {
      console.error("[Speech] Reconocimiento de voz no soportado");
      return;
    }

    this.recognition = new window.webkitSpeechRecognition();
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
      console.log("[Speech] Reconocimiento finalizado");
      if (this.isStarted) {
        try {
          this.recognition.start();
        } catch (error) {
          console.error("[Speech] Error al reiniciar:", error);
        }
      }
    };

    this.recognition.onresult = async (event: any) => {
      try {
        const text = event.results[event.results.length - 1][0].transcript;
        console.log("[Speech] Texto reconocido:", text);

        const response = await fetch("/api/translate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            from: this.language,
            to: this.language === "es" ? "it" : "es"
          }),
        });

        if (!response.ok) {
          throw new Error(`Error de traducción: ${response.status}`);
        }

        const { translated } = await response.json();
        console.log("[Speech] Traducción:", translated);

        if (this.ws.readyState === WebSocket.OPEN) {
          const message = {
            type: "translation",
            text,
            from: this.language,
            translated
          };

          this.ws.send(JSON.stringify(message));
          this.onTranscript(text, translated);
        }
      } catch (error) {
        console.error("[Speech] Error:", error);
      }
    };
  }

  start() {
    if (this.recognition && !this.isStarted) {
      try {
        this.recognition.start();
      } catch (error) {
        console.error("[Speech] Error al iniciar:", error);
      }
    }
  }

  stop() {
    if (this.recognition) {
      this.isStarted = false;
      try {
        this.recognition.stop();
      } catch (error) {
        console.error("[Speech] Error al detener:", error);
      }
    }
    this.ws.close();
  }
}