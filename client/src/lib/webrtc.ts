import { io, type Socket } from "socket.io-client";
import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private socket: Socket;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private isReconnecting = false;
  private reconnectTimer?: number;
  private connectionMonitorTimer?: number;
  private lastIceCandidate?: RTCIceCandidate;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    console.log("[WebRTC] Initializing for room:", roomId);

    // Initialize Socket.IO with reconnection settings
    this.socket = io({
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket']
    });

    this.setupPeerConnection();
    this.setupSocketEvents();
    this.startConnectionMonitoring();
  }

  private setupPeerConnection() {
    try {
      this.pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun3.l.google.com:19302" },
          { urls: "stun:stun4.l.google.com:19302" }
        ],
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      });

      this.pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          console.log("[WebRTC] New ICE candidate");
          this.lastIceCandidate = candidate;
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

        if (state === 'failed' || state === 'disconnected') {
          this.handleConnectionFailure();
        } else if (state === 'connected') {
          this.resetReconnectionState();
        }
      };

      this.pc.oniceconnectionstatechange = () => {
        const state = this.pc.iceConnectionState;
        console.log("[WebRTC] ICE connection state:", state);

        if (state === 'failed') {
          console.log("[WebRTC] ICE connection failed, attempting recovery");
          this.handleIceFailure();
        } else if (state === 'disconnected') {
          console.log("[WebRTC] ICE disconnected, monitoring for recovery");
          this.monitorIceRecovery();
        }
      };

      this.pc.onsignalingstatechange = () => {
        console.log("[WebRTC] Signaling state:", this.pc.signalingState);
        if (this.pc.signalingState === 'closed') {
          this.handleSignalingFailure();
        }
      };

    } catch (error) {
      console.error("[WebRTC] Error setting up peer connection:", error);
      this.onError(error as Error);
    }
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
          const offer = await this.pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
            iceRestart: this.isReconnecting
          });
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

  private startConnectionMonitoring() {
    // Monitor connection quality every 2 seconds
    this.connectionMonitorTimer = window.setInterval(() => {
      if (this.pc && this.pc.connectionState === 'connected') {
        this.pc.getStats().then(stats => {
          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              console.log("[WebRTC] Connection quality:", {
                currentRoundTripTime: report.currentRoundTripTime,
                availableOutgoingBitrate: report.availableOutgoingBitrate,
                bytesReceived: report.bytesReceived,
                bytesSent: report.bytesSent
              });
            }
          });
        });
      }
    }, 2000);
  }

  private async handleConnectionFailure() {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("[WebRTC] Max reconnection attempts reached or already reconnecting");
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    console.log(`[WebRTC] Connection failure, attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

    try {
      // Limpiar estado actual
      if (this.pc.signalingState !== 'closed') {
        this.pc.close();
      }

      // Recrear conexión
      this.setupPeerConnection();
      if (this.stream) {
        await this.start(this.stream);
      }

      // Reiniciar proceso de señalización
      this.socket.emit('join', { roomId: this.roomId });

    } catch (error) {
      console.error("[WebRTC] Reconnection attempt failed:", error);

      // Programar siguiente intento
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
      this.reconnectTimer = window.setTimeout(() => {
        this.handleConnectionFailure();
      }, delay);
    }
  }

  private async handleIceFailure() {
    console.log("[WebRTC] Handling ICE failure");
    try {
      if (this.pc.signalingState === 'stable') {
        const offer = await this.pc.createOffer({ iceRestart: true });
        await this.pc.setLocalDescription(offer);
        this.socket.emit('signal', { type: 'offer', payload: offer });
      }
    } catch (error) {
      console.error("[WebRTC] ICE restart failed:", error);
      this.handleConnectionFailure();
    }
  }

  private monitorIceRecovery() {
    let monitoringAttempts = 0;
    const maxMonitoringAttempts = 5;
    const monitorInterval = setInterval(() => {
      monitoringAttempts++;

      if (this.pc.iceConnectionState === 'connected' ||
          this.pc.iceConnectionState === 'completed') {
        clearInterval(monitorInterval);
        console.log("[WebRTC] ICE connection recovered");
      } else if (monitoringAttempts >= maxMonitoringAttempts) {
        clearInterval(monitorInterval);
        console.log("[WebRTC] ICE recovery monitoring timeout, initiating reconnection");
        this.handleIceFailure();
      }
    }, 1000);
  }

  private handleSignalingFailure() {
    console.log("[WebRTC] Handling signaling failure");
    if (!this.isReconnecting) {
      this.handleConnectionFailure();
    }
  }

  private resetReconnectionState() {
    console.log("[WebRTC] Resetting reconnection state");
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
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
    if (this.connectionMonitorTimer) {
      clearInterval(this.connectionMonitorTimer);
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.pc.close();
    this.socket.disconnect();
  }
}