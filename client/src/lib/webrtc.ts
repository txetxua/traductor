import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc!: RTCPeerConnection;
  private stream?: MediaStream;
  private ws!: WebSocket;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    this.initializePeerConnection();
    this.initializeWebSocket();
  }

  private initializeWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("[WebRTC] WebSocket conectado");
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
    };

    this.ws.onclose = () => {
      console.log("[WebRTC] WebSocket cerrado");
    };

    this.ws.onerror = (error) => {
      console.error("[WebRTC] Error en WebSocket:", error);
      this.onError(new Error("Error en la conexión WebSocket"));
    };

    this.ws.onmessage = this.handleWebSocketMessage.bind(this);
  }

  private async handleWebSocketMessage(event: MessageEvent) {
    try {
      const message: SignalingMessage = JSON.parse(event.data);
      console.log("[WebRTC] Mensaje recibido:", message.type);

      switch (message.type) {
        case "offer":
          await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.sendSignaling({
            type: "answer",
            payload: answer
          });
          break;

        case "answer":
          await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          break;

        case "ice-candidate":
          if (message.payload) {
            await this.pc.addIceCandidate(message.payload);
          }
          break;
      }
    } catch (err) {
      console.error("[WebRTC] Error procesando mensaje:", err);
      this.onError(err as Error);
    }
  }

  private initializePeerConnection() {
    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    };

    this.pc = new RTCPeerConnection(configuration);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.sendSignaling({
          type: "ice-candidate",
          payload: candidate
        });
      }
    };

    this.pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.onRemoteStream(remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Estado de conexión:", this.pc.connectionState);
      this.onConnectionStateChange(this.pc.connectionState);
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.sendSignaling({
          type: "offer",
          payload: offer
        });
      } catch (err) {
        console.error("[WebRTC] Error en negociación:", err);
        this.onError(err as Error);
      }
    };
  }

  async start(stream: MediaStream) {
    try {
      this.stream = stream;

      this.stream.getTracks().forEach(track => {
        if (this.stream) {
          this.pc.addTrack(track, this.stream);
        }
      });

    } catch (err) {
      console.error("[WebRTC] Error al iniciar:", err);
      this.onError(err as Error);
      throw err;
    }
  }

  private sendSignaling(message: SignalingMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.pc.close();
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}