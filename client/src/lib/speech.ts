import { type Language, type TranslationMessage } from "@shared/schema";

export class SpeechHandler {
  private recognition?: any;
  private ws!: WebSocket;
  private isStarted: boolean = false;

  constructor(
    private roomId: string,
    private language: Language,
    private onTranscript: (text: string) => void
  ) {
    this.initializeWebSocket();
    this.setupRecognition();
  }

  private initializeWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "translation") {
          const translationMsg = message as TranslationMessage;
          // Solo procesamos mensajes del otro participante
          if (translationMsg.from !== this.language) {
            // Mostramos solo el texto original
            this.onTranscript(translationMsg.text);
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

    this.recognition = new (window as any).webkitSpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;

    const langMap = {
      es: "es-ES",
      it: "it-IT"
    };
    this.recognition.lang = langMap[this.language];

    this.recognition.onstart = () => {
      this.isStarted = true;
    };

    this.recognition.onend = () => {
      if (this.isStarted) {
        try {
          this.recognition.start();
        } catch (error) {
          console.error("[Speech] Error al reiniciar:", error);
        }
      }
    };

    this.recognition.onresult = async (event: any) => {
      const text = event.results[event.results.length - 1][0].transcript;

      // Para el emisor, mostramos su propio texto
      this.onTranscript(text);

      // Enviar al otro participante
      if (this.ws.readyState === WebSocket.OPEN) {
        const message: TranslationMessage = {
          type: "translation",
          text,
          from: this.language,
          translated: text // Enviamos el mismo texto como traducción
        };
        this.ws.send(JSON.stringify(message));
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