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

  constructor(
    private roomId: string,
    private language: Language,
    private onTranscript: (text: string, translated: string) => void
  ) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("[Speech] WebSocket conectado");
      this.ws.send(JSON.stringify({ type: "join", roomId }));
    };

    this.ws.onclose = () => {
      console.log("[Speech] WebSocket cerrado, intentando reconectar...");
      // Intentar reconectar en 2 segundos
      this.reconnectTimeout = setTimeout(() => {
        if (this.isStarted) {
          this.ws = new WebSocket(wsUrl);
        }
      }, 2000);
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

    this.setupRecognition();
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
      const text = event.results[event.results.length - 1][0].transcript;
      console.log("[Speech] Texto reconocido:", text);

      try {
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
        console.log("[Speech] Enviando traducción:", message);
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(message));
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