import { type Language } from "@shared/schema";

type MessageHandler = (message: any) => void;

const API_URL = import.meta.env.VITE_API_URL || "https://tu-backend.railway.app";

export class WebSocketHandler {
  private ws: WebSocket | null = null;
  private messageHandlers = new Map<string, MessageHandler>();
  private isConnected = false;
  private reconnectTimer: number | null = null;
  private maxRetries = 3;
  private retryCount = 0;
  private retryDelay = 1000;
  private pingInterval: number | null = null;

  constructor(
    private roomId: string,
    private onError?: (error: Error) => void
  ) {
    console.log("[WebSocket] Initializing for room:", roomId);
    this.connect();
  }

  private getWebSocketUrl(): string {
    const wsUrl = API_URL.replace(/^http/, "ws") + "/ws";
    console.log("[WebSocket] Using URL:", wsUrl);
    return wsUrl;
  }

  private connect() {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log("[WebSocket] Already connected");
        return;
      }

      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      const wsUrl = this.getWebSocketUrl();
      console.log("[WebSocket] Connecting to:", wsUrl, "Attempt:", this.retryCount + 1);

      this.ws = new WebSocket(wsUrl);
