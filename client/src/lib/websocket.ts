import { type Language } from "@shared/schema";

type MessageHandler = (message: any) => void;

export class WebSocketHandler {
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private isConnected: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(
    private roomId: string,
    private onError?: (error: Error) => void
  ) {
    console.log("[WebSocket] Starting for room:", roomId);
  }

  private getWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }

  public connect() {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log("[WebSocket] Connection already active");
        return;
      }

      // Clean up any existing connection
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      const wsUrl = this.getWebSocketUrl();
      console.log("[WebSocket] Connecting to:", wsUrl);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[WebSocket] Connected successfully");
        this.isConnected = true;

        // Join the room
        this.send({ type: "join", roomId: this.roomId });
      };

      this.ws.onclose = () => {
        console.log("[WebSocket] Connection closed");
        this.isConnected = false;

        // Simple reconnection after 2 seconds
        if (!this.reconnectTimeout) {
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            if (!this.isConnected) {
              console.log("[WebSocket] Attempting to reconnect...");
              this.connect();
            }
          }, 2000);
        }
      };

      this.ws.onerror = (event) => {
        console.error("[WebSocket] Connection error:", event);
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
      console.error("[WebSocket] Error initializing connection:", error);
      this.onError?.(error as Error);
    }
  }

  public send(message: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[WebSocket] Cannot send message, connection not open");
      return;
    }

    try {
      const messageStr = JSON.stringify(message);
      console.log("[WebSocket] Sending message:", message);
      this.ws.send(messageStr);
    } catch (error) {
      console.error("[WebSocket] Error sending message:", error);
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
    console.log("[WebSocket] Closing connection");
    this.isConnected = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.close();
      } catch (error) {
        console.error("[WebSocket] Error closing connection:", error);
      }
    }
    this.ws = null;
  }
}