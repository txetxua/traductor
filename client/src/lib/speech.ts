import { type Language, type TranslationMessage } from "@shared/schema";

export class SpeechHandler {
  private recognition?: any;
  private ws!: WebSocket;
  private isStarted: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout?: NodeJS.Timeout;
  private connectionTimeout?: NodeJS.Timeout;

  constructor(
    private roomId: string,
    private language: Language,
    private onTranscript: (text: string, isLocal: boolean) => void,
    private onError?: (error: Error) => void
  ) {
    console.log("[Speech] Iniciando para sala:", roomId, "idioma:", language);
    this.initializeWebSocket();
    this.setupRecognition();
  }

  private getWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/socket`; // Changed from /ws to /socket
    console.log("[Speech] URL WebSocket configurada:", {
      protocol,
      host,
      wsUrl,
      windowProtocol: window.location.protocol,
      windowHost: window.location.host
    });
    return wsUrl;
  }

  private initializeWebSocket() {
    try {
      const wsUrl = this.getWebSocketUrl();
      console.log("[Speech] Iniciando conexión WebSocket:", wsUrl);

      // Cerrar conexión existente si hay alguna
      if (this.ws) {
        console.log("[Speech] Estado de WebSocket existente:", {
          readyState: this.ws.readyState,
          url: this.ws.url
        });
        if (this.ws.readyState === WebSocket.OPEN) {
          console.log("[Speech] Cerrando conexión WebSocket existente");
          this.ws.close();
        }
      }

      this.ws = new WebSocket(wsUrl);
      console.log("[Speech] Nuevo WebSocket creado, estado:", this.ws.readyState);

      // Configurar timeout de conexión
      this.connectionTimeout = setTimeout(() => {
        if (this.ws.readyState !== WebSocket.OPEN) {
          console.error("[Speech] Timeout de conexión WebSocket después de 10s");
          this.ws.close();
          this.handleReconnect();
        }
      }, 10000);

      this.ws.onopen = () => {
        console.log("[Speech] WebSocket conectado exitosamente");
        clearTimeout(this.connectionTimeout);
        this.reconnectAttempts = 0;

        // Unirse a la sala inmediatamente después de conectar
        const joinMessage = { type: "join", roomId: this.roomId };
        console.log("[Speech] Enviando mensaje de unión a sala:", joinMessage);
        this.ws.send(JSON.stringify(joinMessage));
      };

      this.ws.onclose = (event) => {
        clearTimeout(this.connectionTimeout);
        console.log("[Speech] Conexión WebSocket cerrada:", {
          clean: event.wasClean,
          code: event.code,
          reason: event.reason || "Sin razón especificada",
          readyState: this.ws.readyState
        });
        this.handleReconnect();
      };

      this.ws.onerror = (event) => {
        console.error("[Speech] Error en WebSocket:", {
          type: event.type,
          message: (event as any).message,
          error: (event as any).error,
          readyState: this.ws.readyState
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("[Speech] Mensaje recibido:", message);

          if (message.type === "error") {
            console.error("[Speech] Error del servidor:", message.error);
            this.onError?.(new Error(message.error));
            return;
          }

          if (message.type === "joined") {
            console.log("[Speech] Unido a sala:", message.roomId);
            return;
          }

          if (message.type === "translation") {
            const translationMsg = message as TranslationMessage;
            console.log("[Speech] Traducción recibida:", translationMsg);

            // Solo mostrar traducciones de otros participantes
            if (translationMsg.from !== this.language) {
              console.log("[Speech] Mostrando traducción:", translationMsg.translated);
              this.onTranscript(translationMsg.translated, false);
            } else {
              console.log("[Speech] Ignorando traducción local");
            }
          }
        } catch (error) {
          console.error("[Speech] Error procesando mensaje:", error);
          this.onError?.(error as Error);
        }
      };
    } catch (error) {
      console.error("[Speech] Error inicializando WebSocket:", {
        error,
        message: (error as Error).message,
        stack: (error as Error).stack
      });
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
      this.onError?.(new Error("No se pudo establecer conexión"));
    }
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
          if (this.ws.readyState === WebSocket.OPEN) {
            const message: TranslationMessage = {
              type: "translation",
              text,
              from: this.language,
              translated
            };
            console.log("[Speech] Enviando traducción:", message);
            this.ws.send(JSON.stringify(message));
          } else {
            console.error("[Speech] WebSocket no está listo");
            this.initializeWebSocket();
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

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}