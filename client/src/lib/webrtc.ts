import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private ws: WebSocket;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    // Initialize WebRTC
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
      ]
    });

    // Setup WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    this.setupWebRTC();
    this.setupWebSocket();
  }

  private setupWebRTC() {
    // Handle ICE candidates
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.sendSignal({
          type: "ice-candidate",
          payload: candidate
        });
      }
    };

    // Handle remote streams
    this.pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.onRemoteStream(remoteStream);
      }
    };

    // Handle connection state changes
    this.pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", this.pc.connectionState);
      this.onConnectionStateChange(this.pc.connectionState);
    };
  }

  private setupWebSocket() {
    this.ws.onopen = () => {
      console.log("[WebSocket] Connected");
      // Join room
      this.ws.send(JSON.stringify({
        type: "join",
        roomId: this.roomId
      }));
    };

    this.ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "joined") {
          console.log("[WebSocket] Joined room", message);
          return;
        }

        if (message.type === "error") {
          this.onError(new Error(message.error));
          return;
        }

        // Handle WebRTC signaling messages
        await this.handleSignal(message);
      } catch (error) {
        console.error("[WebSocket] Message error:", error);
        this.onError(error as Error);
      }
    };

    this.ws.onerror = (error) => {
      console.error("[WebSocket] Error:", error);
      this.onError(new Error("Error de conexión con el servidor"));
    };
  }

  private async handleSignal(message: SignalingMessage) {
    try {
      switch (message.type) {
        case "offer":
          if (this.pc.signalingState === "stable") {
            await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.sendSignal({ type: "answer", payload: answer });
          }
          break;

        case "answer":
          if (this.pc.signalingState === "have-local-offer") {
            await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          }
          break;

        case "ice-candidate":
          if (this.pc.remoteDescription && message.payload) {
            await this.pc.addIceCandidate(message.payload);
          }
          break;
      }
    } catch (error) {
      console.error("[WebRTC] Signal error:", error);
      this.onError(error as Error);
    }
  }

  private sendSignal(message: SignalingMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error("[WebRTC] WebSocket not ready");
      this.onError(new Error("No se pudo enviar el mensaje: conexión no establecida"));
    }
  }

  async start(stream: MediaStream) {
    try {
      this.stream = stream;
      this.stream.getTracks().forEach(track => {
        if (this.stream) {
          this.pc.addTrack(track, this.stream);
        }
      });

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
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }

    this.pc.close();
    this.ws.close();
  }
}