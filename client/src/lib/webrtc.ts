import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc!: RTCPeerConnection;
  private stream?: MediaStream;
  private ws!: WebSocket;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

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
    console.log("Conectando a WebSocket:", wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("WebSocket conectado, uniéndose a sala:", this.roomId);
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
      this.reconnectAttempts = 0;
    };

    this.ws.onclose = () => {
      console.log("Conexión WebSocket cerrada");
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`Intentando reconectar (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.initializeWebSocket(), 2000);
      } else {
        this.onError(new Error("No se pudo reconectar al servidor"));
      }
    };

    this.ws.onerror = (error) => {
      console.error("Error en WebSocket:", error);
      this.onError(new Error("Error en la conexión con el servidor"));
    };

    this.ws.onmessage = this.handleWebSocketMessage.bind(this);
  }

  private initializePeerConnection() {
    console.log("Inicializando RTCPeerConnection");

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
      ],
      iceTransportPolicy: "all"
    };

    this.pc = new RTCPeerConnection(configuration);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log("Nuevo candidato ICE:", candidate);
        this.sendSignaling({
          type: "ice-candidate",
          payload: candidate
        });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      console.log("Estado de conexión ICE cambiado a:", state);

      if (state === 'connected') {
        console.log("Conexión ICE establecida exitosamente");
        this.onConnectionStateChange('connected');
      } else if (state === 'failed') {
        console.error("Conexión ICE fallida");
        this.onError(new Error("La conexión de video ha fallado"));
      }
    };

    this.pc.ontrack = (event) => {
      console.log("Track remoto recibido:", event.track.kind);
      const [remoteStream] = event.streams;
      if (remoteStream) {
        console.log("Configurando stream remoto");
        this.onRemoteStream(remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      console.log("Estado de conexión cambiado a:", state);
      this.onConnectionStateChange(state);

      if (state === 'connected') {
        console.log("Conexión peer establecida exitosamente");
      } else if (state === 'failed') {
        console.error("Conexión peer fallida");
        this.onError(new Error("La conexión con el otro participante ha fallado"));
      }
    };
  }

  private async handleWebSocketMessage(event: MessageEvent) {
    try {
      const message: SignalingMessage = JSON.parse(event.data);
      console.log("Mensaje WebSocket recibido:", message.type);

      switch (message.type) {
        case "offer":
          console.log("Procesando oferta");
          await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.sendSignaling({
            type: "answer",
            payload: answer
          });
          break;

        case "answer":
          console.log("Procesando respuesta");
          await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          break;

        case "ice-candidate":
          console.log("Procesando candidato ICE");
          if (this.pc.remoteDescription) {
            await this.pc.addIceCandidate(new RTCIceCandidate(message.payload));
          }
          break;
      }
    } catch (err) {
      console.error("Error procesando mensaje WebSocket:", err);
      this.onError(err as Error);
    }
  }

  async start(videoEnabled: boolean) {
    try {
      console.log("Iniciando conexión WebRTC con video:", videoEnabled);

      const constraints: MediaStreamConstraints = {
        video: videoEnabled ? {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } : false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      };

      console.log("Solicitando acceso a medios con restricciones:", constraints);
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      console.log("Acceso a medios concedido:", {
        video: this.stream.getVideoTracks().length > 0,
        audio: this.stream.getAudioTracks().length > 0
      });

      this.stream.getTracks().forEach(track => {
        console.log("Añadiendo track a conexión peer:", track.kind);
        if (this.stream) {
          this.pc.addTrack(track, this.stream);
        }
      });

      console.log("Creando y enviando oferta");
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      this.sendSignaling({
        type: "offer",
        payload: offer
      });

      return this.stream;
    } catch (err) {
      console.error("Error al iniciar WebRTC:", err);
      this.onError(err as Error);
      throw err;
    }
  }

  private sendSignaling(message: SignalingMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      console.log("Enviando mensaje de señalización:", message.type);
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket no está abierto, mensaje no enviado:", message.type);
    }
  }

  close() {
    console.log("Cerrando conexión WebRTC");
    this.stream?.getTracks().forEach(track => {
      console.log("Deteniendo track:", track.kind);
      track.stop();
    });
    this.pc.close();
    this.ws.close();
  }
}