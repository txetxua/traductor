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
    console.log("[Speech] Initializing SpeechHandler for room:", roomId, "language:", language);
    this.initializeWebSocket();
    this.setupRecognition();
  }

  private initializeWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    console.log("[Speech] Connecting to WebSocket:", wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[Speech] WebSocket connected");
        this.reconnectAttempts = 0;
        const joinMessage = { type: "join", roomId: this.roomId };
        console.log("[Speech] Sending join message:", joinMessage);
        this.ws.send(JSON.stringify(joinMessage));
      };

      this.ws.onclose = (event) => {
        console.log("[Speech] WebSocket closed. Clean:", event.wasClean, "Code:", event.code);
        this.handleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error("[Speech] WebSocket error:", error);
        this.onError?.(new Error("WebSocket connection error"));
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("[Speech] WebSocket message received:", message);

          if (message.type === "translation") {
            const translationMsg = message as TranslationMessage;

            // Only show translations from the other participant
            if (translationMsg.from !== this.language) {
              console.log("[Speech] Showing translation:", translationMsg.translated);
              this.onTranscript(translationMsg.translated, false);
            }
          }
        } catch (error) {
          console.error("[Speech] Error processing message:", error);
          this.onError?.(error as Error);
        }
      };
    } catch (error) {
      console.error("[Speech] Error initializing WebSocket:", error);
      this.onError?.(error as Error);
    }
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

      console.log(`[Speech] Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }

      this.reconnectTimeout = setTimeout(() => {
        console.log("[Speech] Attempting to reconnect...");
        this.initializeWebSocket();
      }, delay);
    } else {
      console.error("[Speech] Maximum reconnection attempts reached");
      this.onError?.(new Error("Could not reestablish connection"));
    }
  }

  private setupRecognition() {
    if (!("webkitSpeechRecognition" in window)) {
      this.onError?.(new Error("Speech recognition is not supported in this browser"));
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
        console.log("[Speech] Recognition started");
        this.isStarted = true;
      };

      this.recognition.onend = () => {
        console.log("[Speech] Recognition ended");
        if (this.isStarted) {
          console.log("[Speech] Restarting recognition");
          this.recognition.start();
        }
      };

      this.recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') return;
        console.error("[Speech] Recognition error:", event.error);
        this.onError?.(new Error(`Speech recognition error: ${event.error}`));
      };

      this.recognition.onresult = async (event: any) => {
        try {
          const text = event.results[event.results.length - 1][0].transcript;
          console.log("[Speech] Text recognized:", text);

          if (!text.trim()) {
            console.log("[Speech] Empty text, ignoring");
            return;
          }

          // Get translation
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
            throw new Error(`Translation error: ${response.status}`);
          }

          const { translated } = await response.json();
          console.log(`[Speech] Text translated: "${text}" -> "${translated}"`);

          // Send translation through WebSocket
          if (this.ws.readyState === WebSocket.OPEN) {
            const message: TranslationMessage = {
              type: "translation",
              text,
              from: this.language,
              translated
            };
            console.log("[Speech] Sending translation:", message);
            this.ws.send(JSON.stringify(message));
          } else {
            console.error("[Speech] WebSocket is not open");
          }
        } catch (error) {
          console.error("[Speech] Error:", error);
          this.onError?.(error as Error);
        }
      };
    } catch (error) {
      console.error("[Speech] Error setting up recognition:", error);
      this.onError?.(error as Error);
    }
  }

  start() {
    if (this.recognition && !this.isStarted) {
      try {
        this.recognition.start();
      } catch (error) {
        console.error("[Speech] Error starting:", error);
        this.onError?.(error as Error);
      }
    }
  }

  stop() {
    if (this.recognition) {
      this.isStarted = false;
      try {
        this.recognition.stop();
      } catch (error) {
        console.error("[Speech] Error stopping:", error);
      }
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}