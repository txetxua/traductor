import { type Language, type TranslationMessage } from "@shared/schema";

declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

export class SpeechHandler {
  private recognition?: any;
  private ws: WebSocket;
  private isStarted: boolean = false;
  private reconnectTimeout?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

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
    console.log("[Speech] Conectando a WebSocket:", wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("[Speech] WebSocket conectado");
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
      this.reconnectAttempts = 0;
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }
    };

    this.ws.onclose = () => {
      console.log("[Speech] WebSocket cerrado");
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`[Speech] Intentando reconectar (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.reconnectTimeout = setTimeout(() => this.initializeWebSocket(), 2000);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "translation") {
          const translationMsg = message as TranslationMessage;
          // Solo mostramos la traducción si el mensaje viene del otro participante
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

    // Configurar el idioma correcto según el navegador
    const langMap = {
      es: "es-ES",
      it: "it-IT"
    };
    this.recognition.lang = langMap[this.language];

    this.recognition.onstart = () => {
      console.log("[Speech] Reconocimiento de voz iniciado");
      this.isStarted = true;
    };

    this.recognition.onend = () => {
      console.log("[Speech] Reconocimiento de voz finalizado");
      // Reiniciar si todavía está activo
      if (this.isStarted) {
        console.log("[Speech] Reiniciando reconocimiento de voz");
        setTimeout(() => {
          if (this.isStarted) {
            try {
              this.recognition.start();
            } catch (error) {
              console.error("[Speech] Error al reiniciar reconocimiento:", error);
            }
          }
        }, 1000);
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
        console.log("[Speech] Traducción recibida:", translated);

        // Enviar la traducción a través de WebSocket
        const message = {
          type: "translation",
          text,
          from: this.language,
          translated
        };

        if (this.ws.readyState === WebSocket.OPEN) {
          console.log("[Speech] Enviando traducción:", message);
          this.ws.send(JSON.stringify(message));
          // También mostramos localmente nuestra propia traducción
          this.onTranscript(text, translated);
        } else {
          console.warn("[Speech] WebSocket no está abierto, mensaje no enviado");
        }
      } catch (error) {
        console.error("[Speech] Error en proceso de traducción:", error);
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error("[Speech] Error de reconocimiento:", event.error);
      if (event.error === 'no-speech') {
        if (this.isStarted) {
          console.log("[Speech] Reiniciando reconocimiento después del error");
          this.stop();
          setTimeout(() => this.start(), 1000);
        }
      }
    };
  }

  start() {
    if (this.recognition && !this.isStarted) {
      console.log("[Speech] Iniciando reconocimiento de voz");
      this.isStarted = true;
      try {
        this.recognition.start();
      } catch (error) {
        console.error("[Speech] Error al iniciar reconocimiento:", error);
      }
    }
  }

  stop() {
    if (this.recognition) {
      console.log("[Speech] Deteniendo reconocimiento de voz");
      this.isStarted = false;
      try {
        this.recognition.stop();
      } catch (error) {
        console.error("[Speech] Error al detener reconocimiento:", error);
      }
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.ws.close();
  }
}