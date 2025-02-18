import { type Language, type TranslationMessage } from "@shared/schema";

type MessageHandler = (message: any) => void;

export class WebSocketHandler {
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private isConnected: boolean = false;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(
    private roomId: string,
    private onError?: (error: Error) => void
  ) {
    console.log("[WebSocket] Iniciando para sala:", roomId);
  }

  private getWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const baseUrl = window.location.host;
    return `${protocol}//${baseUrl}/ws`;
  }

  public connect() {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log("[WebSocket] Conexión ya activa");
        return;
      }

      const wsUrl = this.getWebSocketUrl();
      console.log("[WebSocket] Iniciando conexión:", wsUrl);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[WebSocket] Conectado exitosamente");
        this.isConnected = true;
        this.startHeartbeat();

        // Unirse a la sala
        this.send({ type: "join", roomId: this.roomId });
      };

      this.ws.onclose = () => {
        console.log("[WebSocket] Conexión cerrada");
        this.isConnected = false;
        this.stopHeartbeat();

        // Un solo intento de reconexión después de 2 segundos
        setTimeout(() => {
          if (!this.isConnected) {
            this.connect();
          }
        }, 2000);
      };

      this.ws.onerror = (event) => {
        console.error("[WebSocket] Error en la conexión:", event);
        this.onError?.(new Error("Error en la conexión WebSocket"));
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("[WebSocket] Mensaje recibido:", message);

          if (message.error) {
            console.error("[WebSocket] Error del servidor:", message.error);
            this.onError?.(new Error(message.error));
            return;
          }

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
        this.send({ type: "heartbeat" });
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  public send(message: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[WebSocket] No se puede enviar mensaje, conexión no está abierta");
      return;
    }

    try {
      const messageStr = JSON.stringify(message);
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

    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.close();
      } catch (error) {
        console.error("[WebSocket] Error cerrando conexión:", error);
      }
    }
    this.ws = null;
  }
}