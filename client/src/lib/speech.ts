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

  constructor(
    private roomId: string,
    private language: Language,
    private onTranscript: (text: string, translated: string) => void
  ) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("Speech WebSocket connected");
      this.ws.send(JSON.stringify({ type: "join", roomId }));
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "translation") {
        const translationMsg = message as TranslationMessage;
        // Solo mostramos la traducción si el mensaje viene del otro participante
        if (translationMsg.from !== this.language) {
          console.log("Recibida traducción del otro participante:", translationMsg);
          this.onTranscript(translationMsg.text, translationMsg.translated);
        }
      }
    };

    this.setupRecognition();
  }

  private setupRecognition() {
    if (!("webkitSpeechRecognition" in window)) {
      console.error("Speech recognition not supported");
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
      console.log("Speech recognition started");
      this.isStarted = true;
    };

    this.recognition.onend = () => {
      console.log("Speech recognition ended");
      // Reiniciar si todavía está activo
      if (this.isStarted) {
        console.log("Restarting speech recognition");
        setTimeout(() => {
          if (this.isStarted) {
            this.recognition.start();
          }
        }, 1000);
      }
    };

    this.recognition.onresult = async (event: any) => {
      const text = event.results[event.results.length - 1][0].transcript;
      console.log("Speech recognized:", text);

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
          throw new Error("Translation failed");
        }

        const { translated } = await response.json();
        console.log("Translation received:", translated);

        // Enviar la traducción a través de WebSocket
        const message = {
          type: "translation",
          text,
          from: this.language,
          translated
        };
        console.log("Enviando traducción:", message);
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error("Translation error:", error);
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === 'no-speech') {
        // Reiniciar el reconocimiento después de un tiempo
        if (this.isStarted) {
          console.log("Restarting speech recognition after error");
          this.stop();
          setTimeout(() => this.start(), 1000);
        }
      }
    };
  }

  start() {
    if (this.recognition && !this.isStarted) {
      console.log("Starting speech recognition");
      this.isStarted = true;
      try {
        this.recognition.start();
      } catch (error) {
        console.error("Error starting speech recognition:", error);
      }
    }
  }

  stop() {
    if (this.recognition) {
      console.log("Stopping speech recognition");
      this.isStarted = false;
      try {
        this.recognition.stop();
      } catch (error) {
        console.error("Error stopping speech recognition:", error);
      }
    }
    this.ws.close();
  }
}