import { io, type Socket } from "socket.io-client";
import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private socket: Socket;
  private messageQueue: SignalingMessage[] = [];
  private connectionPromise?: Promise<void>;
  private connectionResolve?: () => void;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    // Initialize WebRTC with STUN servers
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
      ],
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10
    });

    // Setup Socket.IO with automatic reconnection
    this.socket = io({
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling']
    });

    this.setupSocketIO();
    this.setupWebRTC();
  }

  private setupSocketIO() {
    // Create a promise that resolves when the connection is established
    this.connectionPromise = new Promise((resolve) => {
      this.connectionResolve = resolve;
    });

    this.socket.on('connect', () => {
      console.log("[WebRTC] Socket.IO connected, joining room:", this.roomId);
      this.socket.emit('join', { roomId: this.roomId });
    });

    this.socket.on('joined', async (data) => {
      console.log("[WebRTC] Successfully joined room:", data);

      // Connection is fully established
      this.connectionResolve?.();

      // Process queued messages
      await this.processQueue();
    });

    this.socket.on('signal', async (message: SignalingMessage) => {
      try {
        console.log("[WebRTC] Received signal:", message.type);
        await this.handleSignal(message);
      } catch (error) {
        console.error("[WebRTC] Signal processing error:", error);
        this.onError(error as Error);
      }
    });

    this.socket.on('error', (error) => {
      console.error("[WebRTC] Socket error:", error);
      this.onError(new Error(error.message || "Error de conexión"));
    });

    this.socket.on('disconnect', (reason) => {
      console.log("[WebRTC] Socket disconnected:", reason);

      if (reason === 'io server disconnect') {
        this.socket.connect();
      }

      this.onConnectionStateChange('disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error("[WebRTC] Connection error:", error);
      this.onError(new Error("No se pudo conectar al servidor de señalización"));
    });
  }

  private setupWebRTC() {
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log("[WebRTC] New ICE candidate");
        this.sendSignal({
          type: "ice-candidate",
          payload: candidate
        });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC] ICE connection state:", this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === 'failed') {
        console.log("[WebRTC] ICE connection failed, restarting ICE");
        this.pc.restartIce();
      }
    };

    this.pc.ontrack = (event) => {
      console.log("[WebRTC] Received remote track");
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.onRemoteStream(remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state changed to:", this.pc.connectionState);
      this.onConnectionStateChange(this.pc.connectionState);
    };
  }

  private async handleSignal(message: SignalingMessage) {
    try {
      switch (message.type) {
        case "offer":
          console.log("[WebRTC] Processing offer");
          await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.sendSignal({ type: "answer", payload: answer });
          break;

        case "answer":
          console.log("[WebRTC] Processing answer");
          await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          break;

        case "ice-candidate":
          console.log("[WebRTC] Adding ICE candidate");
          if (this.pc.remoteDescription) {
            await this.pc.addIceCandidate(new RTCIceCandidate(message.payload));
          } else {
            console.log("[WebRTC] Queueing ICE candidate until remote description is set");
            this.messageQueue.push(message);
          }
          break;
      }
    } catch (error) {
      console.error("[WebRTC] Signal handling error:", error);
      this.onError(error as Error);
    }
  }

  private async processQueue() {
    console.log("[WebRTC] Processing message queue:", this.messageQueue.length, "messages");

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          console.log("[WebRTC] Processing queued message:", message.type);
          await this.sendSignal(message);
        } catch (error) {
          console.error("[WebRTC] Error processing queued message:", error);
        }
      }
    }
  }

  private async sendSignal(message: SignalingMessage) {
    try {
      // Wait for connection to be established before sending
      await this.connectionPromise;

      console.log("[WebRTC] Sending signal:", message.type);
      this.socket.emit('signal', message);
    } catch (error) {
      console.error("[WebRTC] Send error:", error);
      this.messageQueue.push(message);
      this.onError(new Error("Error al enviar mensaje de señalización"));
    }
  }

  async start(stream: MediaStream) {
    try {
      console.log("[WebRTC] Starting connection");
      this.stream = stream;

      // Add all tracks to the peer connection
      this.stream.getTracks().forEach(track => {
        if (this.stream) {
          console.log("[WebRTC] Adding track:", track.kind);
          this.pc.addTrack(track, this.stream);
        }
      });

      // Wait for Socket.IO connection before creating offer
      await this.connectionPromise;

      // Create and send offer
      console.log("[WebRTC] Creating offer");
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this.sendSignal({ type: "offer", payload: offer });

    } catch (error) {
      console.error("[WebRTC] Start error:", error);
      this.onError(error as Error);
      throw error;
    }
  }

  close() {
    console.log("[WebRTC] Closing connection");
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    this.pc.close();
    this.socket.disconnect();
  }
}