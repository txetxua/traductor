import { type Language } from "@shared/schema";

type MessageHandler = (message: any) => void;

export class WebSocketHandler {
  private ws: WebSocket | null = null;
  private messageHandlers = new Map<string, MessageHandler>();
  private isConnected = false;
  private reconnectTimer: number | null = null;
  private maxRetries = 5;
  private retryCount = 0;
  private retryDelay = 1000;

  constructor(
    private roomId: string,
    private onError?: (error: Error) => void
  ) {
    console.log("[WebSocket] Initializing for room:", roomId);
    this.connect();
  }

  private getWebSocketUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    console.log("[WebSocket] Using URL:", wsUrl);
    return wsUrl;
  }

  private connect() {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log("[WebSocket] Already connected");
        return;
      }

      // Cleanup existing connection if any
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      const wsUrl = this.getWebSocketUrl();
      console.log("[WebSocket] Connecting to:", wsUrl);

      this.ws = new WebSocket(wsUrl);

      // Set a timeout for the connection attempt
      const connectionTimeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          console.log("[WebSocket] Connection timeout");
          this.ws?.close();
          this.handleReconnect();
        }
      }, 5000);

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log("[WebSocket] Connected successfully");
        this.isConnected = true;
        this.retryCount = 0;
        this.retryDelay = 1000;

        // Join room immediately after connection
        this.send({ type: "join", roomId: this.roomId });
      };

      this.ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log("[WebSocket] Connection closed:", event.code, event.reason);
        this.isConnected = false;
        this.handleReconnect();
      };

      this.ws.onerror = (event) => {
        console.error("[WebSocket] Error occurred:", event);
        // No cerramos la conexión aquí, dejamos que onclose se encargue
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("[WebSocket] Message received:", message.type);

          if (message.error) {
            console.error("[WebSocket] Server error:", message.error);
            this.onError?.(new Error(message.error));
            return;
          }

          const handler = this.messageHandlers.get(message.type);
          if (handler) {
            handler(message);
          }
        } catch (error) {
          console.error("[WebSocket] Error processing message:", error);
          this.onError?.(error as Error);
        }
      };

    } catch (error) {
      console.error("[WebSocket] Setup error:", error);
      this.onError?.(error as Error);
      this.handleReconnect();
    }
  }

  private handleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      console.log(`[WebSocket] Attempting reconnection ${this.retryCount}/${this.maxRetries} in ${this.retryDelay}ms`);

      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, this.retryDelay);

      // Exponential backoff with max delay of 10 seconds
      this.retryDelay = Math.min(this.retryDelay * 2, 10000);
    } else {
      console.error("[WebSocket] Max reconnection attempts reached");
      this.onError?.(new Error("Failed to establish WebSocket connection after maximum attempts"));
    }
  }

  public send(message: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const error = new Error("Cannot send message - WebSocket not connected");
      console.error("[WebSocket]", error);
      this.onError?.(error);
      return;
    }

    try {
      const messageStr = JSON.stringify(message);
      console.log("[WebSocket] Sending:", message.type);
      this.ws.send(messageStr);
    } catch (error) {
      console.error("[WebSocket] Send error:", error);
      this.onError?.(error as Error);
    }
  }

  public onMessage(type: string, handler: MessageHandler) {
    console.log("[WebSocket] Registering handler for:", type);
    this.messageHandlers.set(type, handler);
  }

  public close() {
    console.log("[WebSocket] Closing connection");

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      // Evitar nuevos intentos de reconexión
      this.retryCount = this.maxRetries;

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, "Client closing connection");
      }
      this.ws = null;
    }

    this.isConnected = false;
    this.messageHandlers.clear();
  }
}