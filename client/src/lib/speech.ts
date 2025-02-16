/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { type Language, type TranslationMessage } from "@shared/schema";

declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

export class SpeechHandler {
  private recognition?: any;
  private ws: WebSocket;

  constructor(
    private roomId: string,
    private language: Language,
    private onTranscript: (text: string, translated: string) => void
  ) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: "join", roomId }));
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "translation") {
        const translationMsg = message as TranslationMessage;
        // Solo mostramos la traducción si el mensaje viene del otro participante
        if (translationMsg.from !== this.language) {
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
    this.recognition.lang = this.language === "es" ? "es-ES" : "it-IT";

    this.recognition.onresult = async (event: any) => {
      const text = event.results[event.results.length - 1][0].transcript;
      try {
        // Realizar la solicitud de traducción al servidor
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

        // Enviar tanto el texto original como la traducción a través de WebSocket
        this.ws.send(JSON.stringify({
          type: "translation",
          text,
          from: this.language,
          translated
        }));

        // Mostrar la transcripción localmente
        this.onTranscript(text, "");
      } catch (error) {
        console.error("Translation error:", error);
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
    };
  }

  start() {
    this.recognition?.start();
  }

  stop() {
    this.recognition?.stop();
    this.ws.close();
  }
}