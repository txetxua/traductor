import { io, type Socket } from "socket.io-client";
import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private socket: Socket;
  private messageQueue: SignalingMessage[] = [];
  private isNegotiating = false;

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
    });

    this.socket.on('signal', async (message: SignalingMessage) => {
      try {
        console.log("[WebRTC] Received signal:", message.type);

        switch (message.type) {
          case "offer":
            if (this.pc.signalingState !== "stable") {
              console.log("[WebRTC] Ignoring offer in non-stable state");
              return;
            }
            await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.socket.emit('signal', { type: "answer", payload: answer });
            break;

          case "answer":
            if (this.pc.signalingState === "have-local-offer") {
              await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            }
            break;

          case "ice-candidate":
            if (this.pc.remoteDescription && this.pc.localDescription) {
              await this.pc.addIceCandidate(new RTCIceCandidate(message.payload));
            } else {
              this.messageQueue.push(message);
            }
            break;
        }
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

        console.log("[WebRTC] Creating offer");
        const offer = await this.pc.createOffer();
        if (this.pc.signalingState !== "stable") {
          console.log("[WebRTC] Signaling state is not stable");
          return;
        }
        await this.pc.setLocalDescription(offer);
        this.socket.emit('signal', { type: "offer", payload: offer });
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
        this.socket.emit('signal', {
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

  async start(stream: MediaStream) {
    try {
      console.log("[WebRTC] Starting with local stream");
      this.stream = stream;

      // Add all tracks to the peer connection
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