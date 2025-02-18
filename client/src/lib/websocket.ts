import { type Language, type TranslationMessage } from "@shared/schema";

type MessageHandler = (message: any) => void;

export class WebSocketHandler {
  private ws: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private isConnected: boolean = false;

  constructor(
    private roomId: string,
    private onError?: (error: Error) => void
  ) {
    console.log("[WebSocket] Iniciando para sala:", roomId);
  }

  private getWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const baseUrl = window.location.host;
    const wsUrl = `${protocol}//${baseUrl}/ws`;

    console.log("[WebSocket] Configuración de URL:", {
      protocol,
      baseUrl,
      wsUrl,
      locationHref: window.location.href,
      locationProtocol: window.location.protocol,
      locationHost: window.location.host
    });

    return wsUrl;
  }

  public connect() {
    try {
      if (this.ws) {
        if (this.ws.readyState === WebSocket.OPEN) {
          console.log("[WebSocket] Conexión ya activa");
          return;
        }
        console.log("[WebSocket] Cerrando conexión existente");
        this.ws.close();
        this.ws = null;
      }

      const wsUrl = this.getWebSocketUrl();
      console.log("[WebSocket] Iniciando nueva conexión a:", wsUrl);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[WebSocket] Conexión establecida exitosamente");
        this.reconnectAttempts = 0;
        this.isConnected = true;
        this.startHeartbeat();

        // Unirse a la sala
        this.send({ type: "join", roomId: this.roomId });
      };

      this.ws.onclose = (event) => {
        console.log("[WebSocket] Conexión cerrada:", {
          code: event.code,
          reason: event.reason || "Sin razón especificada",
          wasClean: event.wasClean
        });
        this.isConnected = false;
        this.stopHeartbeat();
        this.handleReconnect();
      };

      this.ws.onerror = (event) => {
        console.error("[WebSocket] Error en la conexión:", event);
        this.onError?.(new Error("Error en la conexión WebSocket"));
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("[WebSocket] Mensaje recibido:", message);
          const handler = this.messageHandlers.get(message.type);
          if (handler) {
            handler(message);
          }
        } catch (error) {
          console.error("[WebSocket] Error procesando mensaje:", error);
          this.onError?.(error as Error);
        }
      };

    } catch (error) {
      console.error("[WebSocket] Error inicializando conexión:", error);
      this.onError?.(error as Error);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.send({ type: "heartbeat" });
          console.log("[WebSocket] Heartbeat enviado");
        } catch (error) {
          console.error("[WebSocket] Error enviando heartbeat:", error);
          this.handleReconnect();
        }
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

      console.log(`[WebSocket] Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts} en ${delay}ms`);

      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }

      this.reconnectTimeout = setTimeout(() => {
        if (!this.isConnected) {
          console.log("[WebSocket] Intentando reconexión...");
          this.connect();
        }
      }, delay);
    } else {
      console.error("[WebSocket] Máximo de intentos de reconexión alcanzado");
      this.onError?.(new Error("No se pudo establecer conexión después de varios intentos"));
    }
  }

  public send(message: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[WebSocket] No se puede enviar mensaje, conexión no está abierta");
      return;
    }

    try {
      const messageStr = JSON.stringify(message);
      console.log("[WebSocket] Enviando mensaje:", message);
      this.ws.send(messageStr);
    } catch (error) {
      console.error("[WebSocket] Error enviando mensaje:", error);
      this.onError?.(error as Error);
    }
  }

  public onMessage(type: string, handler: MessageHandler) {
    this.messageHandlers.set(type, handler);
  }

  public isOpen(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  public close() {
    console.log("[WebSocket] Cerrando conexión");
    this.isConnected = false;
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
        }
      } catch (error) {
        console.error("[WebSocket] Error cerrando conexión:", error);
      }
      this.ws = null;
    }
  }
}