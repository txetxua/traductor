import { io, type Socket } from "socket.io-client";
import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private socket: Socket;
  private isConnected: boolean = false;
  private messageQueue: SignalingMessage[] = [];

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
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    // Setup Socket.IO with automatic reconnection
    this.socket = io({
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    this.setupSocketIO();
    this.setupWebRTC();
  }

  private setupSocketIO() {
    this.socket.on('connect', () => {
      console.log("[WebRTC] Socket.IO connected");
      this.isConnected = true;

      // Join room
      this.socket.emit('join', { roomId: this.roomId });

      // Send any queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (message) this.sendSignal(message);
      }
    });

    this.socket.on('joined', (data) => {
      console.log("[WebRTC] Successfully joined room", data);
    });

    this.socket.on('signal', async (message) => {
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
      this.isConnected = false;

      if (reason === 'io server disconnect') {
        // Servidor cerró la conexión, intentar reconectar
        this.socket.connect();
      }

      this.onConnectionStateChange('disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error("[WebRTC] Connection error:", error);
      this.onError(new Error("No se pudo conectar al servidor"));
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
          }
          break;
      }
    } catch (error) {
      console.error("[WebRTC] Signal handling error:", error);
      this.onError(error as Error);
    }
  }

  private sendSignal(message: SignalingMessage) {
    if (!this.isConnected) {
      console.log("[WebRTC] Connection not ready, queueing message:", message.type);
      this.messageQueue.push(message);
      return;
    }

    try {
      console.log("[WebRTC] Sending signal:", message.type);
      this.socket.emit('signal', message);
    } catch (error) {
      console.error("[WebRTC] Send error:", error);
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

      // Create and send offer
      console.log("[WebRTC] Creating offer");
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendSignal({ type: "offer", payload: offer });

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