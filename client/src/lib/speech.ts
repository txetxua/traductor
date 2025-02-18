import { type Language, type TranslationMessage } from "@shared/schema";

export class SpeechHandler {
  private recognition?: any;
  private ws!: WebSocket;
  private isStarted: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout?: NodeJS.Timeout;

  constructor(
    private roomId: string,
    private language: Language,
    private onTranscript: (text: string, isLocal: boolean) => void,
    private onError?: (error: Error) => void
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
      this.reconnectAttempts = 0;
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
    };

    this.ws.onclose = () => {
      console.log("[Speech] WebSocket cerrado");
      this.handleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error("[Speech] Error en WebSocket:", error);
      this.onError?.(new Error("Error en la conexión WebSocket"));
    };

    this.ws.onmessage = this.handleWebSocketMessage.bind(this);
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[Speech] Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }

      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
      this.reconnectTimeout = setTimeout(() => {
        this.initializeWebSocket();
      }, delay);
    } else {
      console.error("[Speech] Máximo número de intentos de reconexión alcanzado");
      this.onError?.(new Error("No se pudo restablecer la conexión"));
    }
  }

  private handleWebSocketMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data);
      if (message.type === "translation") {
        const translationMsg = message as TranslationMessage;
        console.log("[Speech] Mensaje de traducción recibido:", translationMsg);

        // Si el mensaje es de otro participante (diferente idioma)
        if (translationMsg.from !== this.language) {
          console.log(`[Speech] Procesando traducción de ${translationMsg.from} a ${this.language}`);
          console.log(`[Speech] Texto original: "${translationMsg.text}"`);
          console.log(`[Speech] Texto traducido: "${translationMsg.translated}"`);

          // El receptor ve la traducción en su idioma
          this.onTranscript(translationMsg.translated, false);
        } else {
          console.log(`[Speech] Ignorando mensaje en mismo idioma (${this.language})`);
        }
      }
    } catch (error) {
      console.error("[Speech] Error procesando mensaje:", error);
      this.onError?.(error as Error);
    }
  }

  private setupRecognition() {
    if (!("webkitSpeechRecognition" in window)) {
      console.error("[Speech] Reconocimiento de voz no soportado");
      this.onError?.(new Error("El reconocimiento de voz no está soportado en este navegador"));
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

    console.log("[Speech] Configurando reconocimiento para idioma:", this.language);

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
          this.onError?.(error as Error);
        }
      }
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        // Ignorar este error ya que es común cuando no hay habla
        return;
      }
      console.error("[Speech] Error en reconocimiento:", event.error);
      this.onError?.(new Error(`Error en reconocimiento de voz: ${event.error}`));
    };

    this.recognition.onresult = this.onresult.bind(this);
  }


  private async handleRecognitionResult(text: string) {
    try {
      console.log(`[Speech] Texto reconocido en ${this.language}:`, text);

      // El emisor ve su texto original
      this.onTranscript(text, true);

      // Traducir antes de enviar
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
      console.log(`[Speech] Texto traducido de ${this.language} a ${this.language === "es" ? "it" : "es"}:`, translated);

      // Enviar mensaje con traducción al otro participante
      if (this.ws.readyState === WebSocket.OPEN) {
        const message: TranslationMessage = {
          type: "translation",
          text: text,
          from: this.language,
          translated: translated
        };
        console.log("[Speech] Enviando mensaje de traducción:", message);
        this.ws.send(JSON.stringify(message));
      } else {
        throw new Error("La conexión WebSocket está cerrada");
      }
    } catch (error) {
      console.error("[Speech] Error:", error);
      this.onError?.(error as Error);
    }
  }

  onresult = async (event: any) => {
    const text = event.results[event.results.length - 1][0].transcript;
    await this.handleRecognitionResult(text);
  };


  start() {
    if (this.recognition && !this.isStarted) {
      try {
        console.log("[Speech] Iniciando reconocimiento de voz");
        this.recognition.start();
      } catch (error) {
        console.error("[Speech] Error al iniciar:", error);
        this.onError?.(error as Error);
      }
    }
  }

  stop() {
    if (this.recognition) {
      this.isStarted = false;
      try {
        console.log("[Speech] Deteniendo reconocimiento de voz");
        this.recognition.stop();
      } catch (error) {
        console.error("[Speech] Error al detener:", error);
      }
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}