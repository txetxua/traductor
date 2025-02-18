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
    console.log("[Speech] Inicializando SpeechHandler para sala:", roomId, "idioma:", language);
    this.initializeWebSocket();
    this.setupRecognition();
  }

  private initializeWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    console.log("[Speech] Conectando a WebSocket:", wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[Speech] WebSocket conectado");
        this.reconnectAttempts = 0;

        // Unirse a la sala
        const joinMessage = { type: "join", roomId: this.roomId };
        console.log("[Speech] Enviando mensaje de unión:", joinMessage);
        this.ws.send(JSON.stringify(joinMessage));
      };

      this.ws.onclose = (event) => {
        console.log("[Speech] WebSocket cerrado. Clean:", event.wasClean, "Código:", event.code);
        this.handleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error("[Speech] Error en WebSocket:", error);
        this.onError?.(new Error("Error en la conexión WebSocket"));
      };

      this.ws.onmessage = this.handleWebSocketMessage.bind(this);
    } catch (error) {
      console.error("[Speech] Error inicializando WebSocket:", error);
      this.onError?.(error as Error);
    }
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

      console.log(`[Speech] Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts} en ${delay}ms`);

      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }

      this.reconnectTimeout = setTimeout(() => {
        console.log("[Speech] Intentando reconectar...");
        this.initializeWebSocket();
      }, delay);
    } else {
      console.error("[Speech] Máximo de intentos de reconexión alcanzado");
      this.onError?.(new Error("No se pudo restablecer la conexión"));
    }
  }

  private handleWebSocketMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data);
      console.log("[Speech] Mensaje WebSocket recibido:", message);

      if (message.type === "translation") {
        const translationMsg = message as TranslationMessage;
        console.log("[Speech] Mensaje de traducción recibido:", translationMsg);

        // Solo mostrar traducciones del otro participante
        // Si soy español y recibo un mensaje de italiano -> muestro la traducción en español
        // Si soy italiano y recibo un mensaje de español -> muestro la traducción en italiano
        if (translationMsg.from !== this.language) {
          console.log(`[Speech] Mostrando traducción del mensaje de ${translationMsg.from} a ${this.language}:`, translationMsg.translated);
          this.onTranscript(translationMsg.translated, false);
        }
      }
    } catch (error) {
      console.error("[Speech] Error procesando mensaje:", error);
      this.onError?.(error as Error);
    }
  }

  private setupRecognition() {
    if (!("webkitSpeechRecognition" in window)) {
      this.onError?.(new Error("El reconocimiento de voz no está soportado en este navegador"));
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
        console.log("[Speech] Reconocimiento finalizado");
        if (this.isStarted) {
          this.recognition.start();
        }
      };

      this.recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') return;
        console.error("[Speech] Error en reconocimiento:", event.error);
        this.onError?.(new Error(`Error en reconocimiento de voz: ${event.error}`));
      };

      this.recognition.onresult = async (event: any) => {
        const text = event.results[event.results.length - 1][0].transcript;
        await this.handleRecognitionResult(text);
      };
    } catch (error) {
      console.error("[Speech] Error configurando reconocimiento:", error);
      this.onError?.(error as Error);
    }
  }

  private async handleRecognitionResult(text: string) {
    try {
      // No mostramos el texto original al emisor
      // Solo enviamos para traducir al otro participante

      // Determinar el idioma de destino
      const targetLanguage = this.language === "es" ? "it" : "es";

      // Obtener la traducción
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          from: this.language,
          to: targetLanguage
        })
      });

      if (!response.ok) {
        throw new Error("Error en la traducción");
      }

      const { translated } = await response.json();

      // Enviar la traducción a través de WebSocket
      if (this.ws.readyState === WebSocket.OPEN) {
        const message: TranslationMessage = {
          type: "translation",
          text,
          from: this.language,
          translated
        };
        console.log("[Speech] Enviando traducción:", message);
        this.ws.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error("[Speech] Error:", error);
      this.onError?.(error as Error);
    }
  }

  start() {
    if (this.recognition && !this.isStarted) {
      try {
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
        this.recognition.stop();
      } catch (error) {
        console.error("[Speech] Error al detener:", error);
      }
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}