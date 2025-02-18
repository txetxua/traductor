import { type Language } from "@shared/schema";

type MessageHandler = (message: any) => void;

export class WebSocketHandler {
  private ws: WebSocket | null = null;
  private messageHandlers = new Map<string, MessageHandler>();
  private isConnected = false;
  private reconnectTimer: number | null = null;
  private maxRetries = 3;
  private retryCount = 0;

  constructor(
    private roomId: string,
    private onError?: (error: Error) => void
  ) {
    console.log("[WebSocket] Initializing for room:", roomId);
    this.connect();
  }

  private getWebSocketUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }

  private connect() {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log("[WebSocket] Already connected");
        return;
      }

      const wsUrl = this.getWebSocketUrl();
      console.log("[WebSocket] Connecting to:", wsUrl);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[WebSocket] Connected");
        this.isConnected = true;
        this.retryCount = 0;

        // Join room immediately after connection
        this.send({ type: "join", roomId: this.roomId });
      };

      this.ws.onclose = () => {
        console.log("[WebSocket] Connection closed");
        this.isConnected = false;

        if (this.retryCount < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, this.retryCount), 5000);
          this.retryCount++;

          console.log(`[WebSocket] Reconnecting (${this.retryCount}/${this.maxRetries}) in ${delay}ms`);

          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, delay);
        } else {
          console.error("[WebSocket] Max reconnection attempts reached");
          this.onError?.(new Error("Failed to establish WebSocket connection"));
        }
      };

      this.ws.onerror = (event) => {
        console.error("[WebSocket] Error:", event);
        this.onError?.(new Error("WebSocket connection error"));
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
      console.log("[WebSocket] Sending:", message);
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error("[WebSocket] Send error:", error);
      this.onError?.(error as Error);
    }
  }

  public onMessage(type: string, handler: MessageHandler) {
    this.messageHandlers.set(type, handler);
  }

  public close() {
    console.log("[WebSocket] Closing");

    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.messageHandlers.clear();
  }
}