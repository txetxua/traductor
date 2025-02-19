import { io, type Socket } from "socket.io-client";
import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private socket: Socket;
  private messageQueue: SignalingMessage[] = [];
  private isNegotiating = false;
  private isSocketReady = false;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    console.log("[WebRTC] Starting connection");

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
    this.socket.on('connect', () => {
      console.log("[WebRTC] Socket.IO connected, joining room:", this.roomId);
      this.socket.emit('join', { roomId: this.roomId });
    });

    this.socket.on('joined', async (data) => {
      console.log("[WebRTC] Successfully joined room:", data);
      this.isSocketReady = true;

      // Process any queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (message) {
          await this.sendSignal(message);
        }
      }
    });

    this.socket.on('signal', async (message: SignalingMessage) => {
      try {
        console.log("[WebRTC] Received signal:", message.type);

        if (!this.pc) {
          throw new Error("RTCPeerConnection not initialized");
        }

        switch (message.type) {
          case "offer":
            console.log("[WebRTC] Processing offer in state:", this.pc.signalingState);
            if (this.pc.signalingState !== "stable") {
              console.log("[WebRTC] Ignoring offer in non-stable state");
              return;
            }
            await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            await this.sendSignal({ type: "answer", payload: answer });
            break;

          case "answer":
            console.log("[WebRTC] Processing answer in state:", this.pc.signalingState);
            if (this.pc.signalingState === "have-local-offer") {
              await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            } else {
              console.log("[WebRTC] Ignoring answer in state:", this.pc.signalingState);
            }
            break;

          case "ice-candidate":
            console.log("[WebRTC] Processing ICE candidate");
            if (this.pc.remoteDescription && this.pc.localDescription) {
              await this.pc.addIceCandidate(new RTCIceCandidate(message.payload));
            } else {
              console.log("[WebRTC] Queueing ICE candidate");
              this.messageQueue.push(message);
            }
            break;
        }
      } catch (error) {
        console.error("[WebRTC] Signal processing error:", error);
        this.onError(error as Error);
      }
    });

    this.socket.on('error', (error: any) => {
      const errorMessage = error?.message || JSON.stringify(error) || "Unknown error";
      console.error("[WebRTC] Socket error:", errorMessage);
      this.onError(new Error(`Error de señalización: ${errorMessage}`));
    });

    this.socket.on('disconnect', (reason) => {
      console.log("[WebRTC] Socket disconnected:", reason);
      this.isSocketReady = false;
      this.onConnectionStateChange('disconnected');
    });
  }

  private setupWebRTC() {
    this.pc.onnegotiationneeded = async () => {
      try {
        if (this.isNegotiating) {
          console.log("[WebRTC] Skipping nested negotiation");
          return;
        }
        this.isNegotiating = true;

        if (!this.isSocketReady) {
          console.log("[WebRTC] Socket not ready, waiting...");
          return;
        }

        console.log("[WebRTC] Creating offer");
        const offer = await this.pc.createOffer();
        if (this.pc.signalingState !== "stable") {
          console.log("[WebRTC] Signaling state is not stable");
          return;
        }
        await this.pc.setLocalDescription(offer);
        await this.sendSignal({ type: "offer", payload: offer });
      } catch (error) {
        console.error("[WebRTC] Negotiation error:", error);
        this.onError(error as Error);
      } finally {
        this.isNegotiating = false;
      }
    };

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

    this.pc.onsignalingstatechange = () => {
      console.log("[WebRTC] Signaling state changed to:", this.pc.signalingState);
    };
  }

  private async sendSignal(message: SignalingMessage) {
    if (!this.isSocketReady) {
      console.log("[WebRTC] Socket not ready, queueing message:", message.type);
      this.messageQueue.push(message);
      return;
    }

    try {
      console.log("[WebRTC] Sending signal:", message.type);
      this.socket.emit('signal', message);
    } catch (error) {
      console.error("[WebRTC] Send error:", error);
      this.onError(new Error(`Error al enviar señal ${message.type}: ${error}`));
    }
  }

  async start(stream: MediaStream) {
    try {
      console.log("[WebRTC] Starting with local stream");
      this.stream = stream;

      this.stream.getTracks().forEach(track => {
        if (this.stream) {
          console.log("[WebRTC] Adding track:", track.kind);
          this.pc.addTrack(track, this.stream);
        }
      });
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