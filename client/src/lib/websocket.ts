import { type Language } from "@shared/schema";

type MessageHandler = (message: any) => void;

export class WebSocketHandler {
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private isConnected: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pendingMessages: any[] = [];

  constructor(
    private roomId: string,
    private onError?: (error: Error) => void
  ) {
    if (!roomId) {
      throw new Error("[WebSocket] Room ID is required");
    }
    console.log("[WebSocket] Initializing for room:", roomId);
    this.connect();
  }

  private getWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;
    console.log("[WebSocket] Using WebSocket URL:", wsUrl);
    return wsUrl;
  }

  private connect() {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log("[WebSocket] Connection already active");
        return;
      }

      const wsUrl = this.getWebSocketUrl();
      console.log("[WebSocket] Connecting to:", wsUrl);
      console.log("[WebSocket] Using protocol: translation-protocol");

      this.ws = new WebSocket(wsUrl, ['translation-protocol']);

      this.ws.onopen = () => {
        console.log("[WebSocket] Connection established");
        this.isConnected = true;

        // Enviar mensaje de unión inmediatamente después de la conexión
        this.send({ 
          type: "join", 
          roomId: this.roomId 
        });

        // Procesar mensajes pendientes
        while (this.pendingMessages.length > 0) {
          const message = this.pendingMessages.shift();
          this.send(message);
        }
      };

      this.ws.onclose = (event) => {
        console.log("[WebSocket] Connection closed. Code:", event.code, "Reason:", event.reason);
        this.isConnected = false;

        // No reconectar si el cierre fue limpio (1000) o por protocolo no soportado (1002)
        if (event.code !== 1000 && event.code !== 1002) {
          if (!this.reconnectTimeout) {
            console.log("[WebSocket] Scheduling reconnection attempt...");
            this.reconnectTimeout = setTimeout(() => {
              this.reconnectTimeout = null;
              if (!this.isConnected) {
                console.log("[WebSocket] Attempting to reconnect...");
                this.connect();
              }
            }, 2000);
          }
        } else {
          console.log("[WebSocket] Clean disconnect or protocol error, not attempting to reconnect");
        }
      };

      this.ws.onerror = (event) => {
        const errorMsg = event instanceof ErrorEvent ? event.message : "Unknown WebSocket error";
        console.error("[WebSocket] Connection error:", errorMsg);
        this.onError?.(new Error(`WebSocket connection error: ${errorMsg}`));
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("[WebSocket] Message received:", message);

          if (message.error) {
            console.error("[WebSocket] Server error:", message.error);
            this.onError?.(new Error(message.error));
            return;
          }

          if (message.type === "joined") {
            console.log("[WebSocket] Successfully joined room:", message.roomId);
          }

          const handler = this.messageHandlers.get(message.type);
          if (handler) {
            handler(message);
          } else {
            console.log("[WebSocket] No handler for message type:", message.type);
          }
        } catch (error) {
          console.error("[WebSocket] Error processing message:", error);
          this.onError?.(error as Error);
        }
      };

    } catch (error) {
      console.error("[WebSocket] Error initializing connection:", error);
      this.onError?.(error as Error);
    }
  }

  public send(message: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log("[WebSocket] Connection not ready, queuing message:", message);
      this.pendingMessages.push(message);
      return;
    }

    try {
      console.log("[WebSocket] Sending message:", message);
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error("[WebSocket] Error sending message:", error);
      this.onError?.(error as Error);
    }
  }

  public onMessage(type: string, handler: MessageHandler) {
    console.log("[WebSocket] Registering handler for message type:", type);
    this.messageHandlers.set(type, handler);
  }

  public isOpen(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  public close() {
    console.log("[WebSocket] Closing connection");
    this.isConnected = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        console.error("[WebSocket] Error closing connection:", error);
      }
    }
    this.ws = null;
    this.pendingMessages = [];
  }
}