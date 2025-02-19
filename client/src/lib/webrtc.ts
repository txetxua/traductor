import { io, type Socket } from "socket.io-client";
import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private socket: Socket;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    console.log("[WebRTC] Initializing for room:", roomId);

    // Initialize Socket.IO first
    this.socket = io({
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket']
    });

    // Initialize WebRTC after Socket.IO
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
      ],
      iceTransportPolicy: 'all'
    });

    this.setupSocketEvents();
    this.setupPeerConnection();
  }

  private setupSocketEvents() {
    this.socket.on('connect', () => {
      console.log("[WebRTC] Socket connected, joining room:", this.roomId);
      this.socket.emit('join', { roomId: this.roomId });
    });

    this.socket.on('joined', async (data) => {
      console.log("[WebRTC] Joined room:", this.roomId, "Clients:", data.clients);

      if (data.clients === 2) {
        try {
          console.log("[WebRTC] Creating offer as initiator");
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          this.socket.emit('signal', { type: 'offer', payload: offer });
        } catch (error) {
          console.error("[WebRTC] Error creating offer:", error);
          this.onError(new Error(`Error al crear oferta: ${error}`));
        }
      }
    });

    this.socket.on('signal', async (message: SignalingMessage) => {
      if (!this.pc) {
        console.error("[WebRTC] PeerConnection not initialized");
        return;
      }

      try {
        console.log("[WebRTC] Received signal:", message.type, "State:", this.pc.signalingState);

        switch (message.type) {
          case 'offer':
            if (this.pc.signalingState !== "stable") {
              console.log("[WebRTC] Ignoring offer in state:", this.pc.signalingState);
              return;
            }
            await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.socket.emit('signal', { type: 'answer', payload: answer });
            break;

          case 'answer':
            if (this.pc.signalingState === "have-local-offer") {
              await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            }
            break;

          case 'ice-candidate':
            if (this.pc.remoteDescription && this.pc.localDescription) {
              await this.pc.addIceCandidate(new RTCIceCandidate(message.payload));
            }
            break;
        }
      } catch (error) {
        console.error("[WebRTC] Error processing signal:", message.type, error);
        this.onError(new Error(`Error al procesar señal ${message.type}: ${error}`));
      }
    });

    this.socket.on('error', (error: any) => {
      const errorMessage = typeof error === 'string' ? error : 
        error?.message || JSON.stringify(error) || 'Error desconocido';
      console.error("[WebRTC] Socket error:", errorMessage);
      this.onError(new Error(`Error de señalización: ${errorMessage}`));
    });

    this.socket.on('disconnect', () => {
      console.log("[WebRTC] Socket disconnected");
      this.onConnectionStateChange('disconnected');
    });
  }

  private setupPeerConnection() {
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log("[WebRTC] New ICE candidate");
        this.socket.emit('signal', {
          type: 'ice-candidate',
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
      const state = this.pc.connectionState;
      console.log("[WebRTC] Connection state changed:", state);
      this.onConnectionStateChange(state);
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      console.log("[WebRTC] ICE connection state:", state);

      if (state === 'failed') {
        console.log("[WebRTC] ICE connection failed, restarting");
        this.pc.restartIce();
      }
    };

    this.pc.onsignalingstatechange = () => {
      console.log("[WebRTC] Signaling state:", this.pc.signalingState);
    };
  }

  async start(stream: MediaStream) {
    try {
      console.log("[WebRTC] Starting with stream");
      this.stream = stream;

      for (const track of this.stream.getTracks()) {
        console.log("[WebRTC] Adding track:", track.kind);
        this.pc.addTrack(track, this.stream);
      }
    } catch (error) {
      console.error("[WebRTC] Error starting:", error);
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