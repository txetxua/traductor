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
    console.log("[WebRTC] Conectando a WebSocket:", wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("[WebRTC] WebSocket conectado");
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
    };

    this.ws.onclose = () => {
      console.log("[WebRTC] WebSocket cerrado");
      this.onError(new Error("La conexión con el servidor se ha perdido"));
    };

    this.ws.onerror = (error) => {
      console.error("[WebRTC] Error en WebSocket:", error);
      this.onError(new Error("Error en la conexión con el servidor"));
    };

    this.ws.onmessage = this.handleWebSocketMessage.bind(this);
  }

  private initializePeerConnection() {
    console.log("[WebRTC] Inicializando conexión");

    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        {
          urls: "turn:relay.metered.ca:80",
          username: "83c02581d3f4af5d3446bc3c",
          credential: "L8YGPMtaJJ+tNcYK",
        },
        {
          urls: "turn:relay.metered.ca:443",
          username: "83c02581d3f4af5d3446bc3c",
          credential: "L8YGPMtaJJ+tNcYK",
        },
        {
          urls: "turn:relay.metered.ca:443?transport=tcp",
          username: "83c02581d3f4af5d3446bc3c",
          credential: "L8YGPMtaJJ+tNcYK",
        }
      ]
    };

    this.pc = new RTCPeerConnection(configuration);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log("[WebRTC] Nuevo candidato ICE");
        this.sendSignaling({
          type: "ice-candidate",
          payload: candidate
        });
      }
    };

    this.pc.ontrack = (event) => {
      console.log("[WebRTC] Track remoto recibido:", event.track.kind);
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.onRemoteStream(remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      console.log("[WebRTC] Estado de conexión:", state);
      this.onConnectionStateChange(state);
    };
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
          if (this.pc.remoteDescription) {
            await this.pc.addIceCandidate(new RTCIceCandidate(message.payload));
          }
          break;
      }
    } catch (err) {
      console.error("[WebRTC] Error procesando mensaje:", err);
      this.onError(err as Error);
    }
  }

  async start(videoEnabled: boolean) {
    try {
      console.log("[WebRTC] Iniciando con video:", videoEnabled);

      const constraints: MediaStreamConstraints = {
        video: videoEnabled,
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("[WebRTC] Stream local obtenido");

      this.stream.getTracks().forEach(track => {
        if (this.stream) {
          this.pc.addTrack(track, this.stream);
        }
      });

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendSignaling({
        type: "offer",
        payload: offer
      });

      return this.stream;
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
    console.log("[WebRTC] Cerrando conexión");
    this.stream?.getTracks().forEach(track => track.stop());
    this.pc.close();
    this.ws.close();
  }
}