import { type Language, type TranslationMessage } from "@shared/schema";

type MessageHandler = (message: any) => void;

export class WebSocketHandler {
  private ws: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout?: NodeJS.Timeout;
  private connectionTimeout?: NodeJS.Timeout;
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
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/socket`;
    console.log("[WebSocket] URL configurada:", {
      protocol,
      host,
      wsUrl,
      windowProtocol: window.location.protocol,
      windowHost: window.location.host
    });
    return wsUrl;
  }

  public connect() {
    try {
      const wsUrl = this.getWebSocketUrl();
      console.log("[WebSocket] Iniciando conexión:", wsUrl);

      if (this.ws) {
        console.log("[WebSocket] Estado de conexión existente:", {
          readyState: this.ws.readyState,
          url: this.ws.url
        });
        if (this.ws.readyState === WebSocket.OPEN) {
          console.log("[WebSocket] Cerrando conexión existente");
          this.ws.close();
        }
      }

      this.ws = new WebSocket(wsUrl);
      console.log("[WebSocket] Nueva conexión creada, estado:", this.ws.readyState);

      this.connectionTimeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          console.error("[WebSocket] Timeout de conexión después de 10s");
          this.ws?.close();
          this.handleReconnect();
        }
      }, 10000);

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);

    } catch (error) {
      console.error("[WebSocket] Error inicializando:", {
        error,
        message: (error as Error).message,
        stack: (error as Error).stack
      });
      this.onError?.(error as Error);
    }
  }

  private handleOpen() {
    console.log("[WebSocket] Conectado exitosamente");
    clearTimeout(this.connectionTimeout);
    this.reconnectAttempts = 0;
    this.isConnected = true;

    // Unirse a la sala
    const joinMessage = { type: "join", roomId: this.roomId };
    console.log("[WebSocket] Enviando mensaje de unión:", joinMessage);
    this.send(joinMessage);
  }

  private handleClose(event: CloseEvent) {
    clearTimeout(this.connectionTimeout);
    this.isConnected = false;
    console.log("[WebSocket] Conexión cerrada:", {
      clean: event.wasClean,
      code: event.code,
      reason: event.reason || "Sin razón especificada",
      readyState: this.ws?.readyState
    });
    this.handleReconnect();
  }

  private handleError(event: Event) {
    console.error("[WebSocket] Error:", {
      type: event.type,
      message: (event as any).message,
      error: (event as any).error,
      readyState: this.ws?.readyState
    });
  }

  private handleMessage(event: MessageEvent) {
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
        console.log("[WebSocket] Intentando reconectar...");
        this.connect();
      }, delay);
    } else {
      console.error("[WebSocket] Máximo de intentos de reconexión alcanzado");
      this.onError?.(new Error("No se pudo establecer conexión"));
    }
  }

  public send(message: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error("[WebSocket] No se puede enviar mensaje, conexión no está abierta");
      this.handleReconnect();
    }
  }

  public onMessage(type: string, handler: MessageHandler) {
    this.messageHandlers.set(type, handler);
  }

  public isOpen(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  public close() {
    this.isConnected = false;
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
