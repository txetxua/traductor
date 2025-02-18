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
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      console.log("[Speech] Conectando a WebSocket:", wsUrl);

      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log("[Speech] Cerrando conexión WebSocket existente");
        this.ws.close();
      }

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[Speech] WebSocket conectado");
        this.reconnectAttempts = 0;
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
      console.log(`[Speech] Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }
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
      console.log("[Speech] Mensaje WebSocket recibido:", message);

      if (message.type === "translation") {
        const translationMsg = message as TranslationMessage;
        console.log("[Speech] Mensaje de traducción recibido:", translationMsg);

        // Si soy italiano (it) y recibo un mensaje en español (es), muestro la traducción
        if (this.language === "it" && translationMsg.from === "es") {
          console.log("[Speech] (Receptor IT) Mostrando traducción al italiano:", translationMsg.translated);
          this.onTranscript(translationMsg.translated, false);
        }
        // Si soy español (es) y recibo un mensaje en italiano (it), muestro la traducción
        else if (this.language === "es" && translationMsg.from === "it") {
          console.log("[Speech] (Emisor ES) Mostrando traducción al español:", translationMsg.translated);
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
      console.error("[Speech] Reconocimiento de voz no soportado");
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
          return;
        }
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
      console.log(`[Speech] Texto reconocido en ${this.language}:`, text);

      // Mostramos el texto original al emisor
      this.onTranscript(text, true);

      // Determinamos el idioma de destino basado en el idioma actual
      const targetLanguage = this.language === "es" ? "it" : "es";

      // Traducimos y enviamos el mensaje
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          from: this.language,
          to: targetLanguage
        }),
      });

      if (!response.ok) {
        throw new Error(`Error de traducción: ${response.status}`);
      }

      const { translated } = await response.json();
      console.log(`[Speech] Texto traducido de ${this.language} a ${targetLanguage}:`, translated);

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
        console.error("[Speech] WebSocket no está abierto. Estado:", this.ws.readyState);
        throw new Error("La conexión WebSocket está cerrada");
      }
    } catch (error) {
      console.error("[Speech] Error:", error);
      this.onError?.(error as Error);
    }
  }

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
    console.log("[Speech] Deteniendo SpeechHandler");
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
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log("[Speech] Cerrando conexión WebSocket");
      this.ws.close();
    }
  }
}