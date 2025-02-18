import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc!: RTCPeerConnection;
  private stream?: MediaStream;
  private ws!: WebSocket;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout?: NodeJS.Timeout;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    console.log("[WebRTC] Inicializando conexión");
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
      this.reconnectAttempts = 0;
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
    };

    this.ws.onclose = () => {
      console.log("[WebRTC] WebSocket cerrado");
      this.handleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error("[WebRTC] Error en WebSocket:", error);
      this.onError(new Error("Error en la conexión WebSocket"));
    };

    this.ws.onmessage = this.handleWebSocketMessage.bind(this);
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[WebRTC] Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
      this.reconnectTimeout = setTimeout(() => {
        this.initializePeerConnection();
        this.initializeWebSocket();
      }, delay);
    } else {
      console.error("[WebRTC] Máximo número de intentos de reconexión alcanzado");
      this.onError(new Error("No se pudo restablecer la conexión"));
    }
  }

  private async handleWebSocketMessage(event: MessageEvent) {
    try {
      const message: SignalingMessage = JSON.parse(event.data);
      console.log("[WebRTC] Mensaje recibido:", message.type);

      switch (message.type) {
        case "offer":
          console.log("[WebRTC] Procesando oferta");
          await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.sendSignaling({
            type: "answer",
            payload: answer
          });
          break;

        case "answer":
          console.log("[WebRTC] Procesando respuesta");
          await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          break;

        case "ice-candidate":
          if (message.payload) {
            console.log("[WebRTC] Agregando candidato ICE");
            try {
              await this.pc.addIceCandidate(message.payload);
            } catch (err) {
              console.error("[WebRTC] Error al agregar candidato ICE:", err);
            }
          }
          break;
      }
    } catch (err) {
      console.error("[WebRTC] Error procesando mensaje:", err);
      this.onError(err as Error);
    }
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

    this.pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC] Estado de conexión ICE:", this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === 'failed') {
        console.log("[WebRTC] Reiniciando ICE tras fallo");
        this.pc.restartIce();
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Estado de conexión:", this.pc.connectionState);
      this.onConnectionStateChange(this.pc.connectionState);
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        console.log("[WebRTC] Negociación necesaria");
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.sendSignaling({
          type: "offer",
          payload: this.pc.localDescription
        });
      } catch (err) {
        console.error("[WebRTC] Error en negociación:", err);
      }
    };
  }

  async start(videoEnabled: boolean) {
    try {
      console.log("[WebRTC] Iniciando con video:", videoEnabled);

      const constraints: MediaStreamConstraints = {
        video: videoEnabled ? {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } : false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("[WebRTC] Stream local obtenido");

      this.stream.getTracks().forEach(track => {
        if (this.stream) {
          console.log("[WebRTC] Agregando track:", track.kind);
          this.pc.addTrack(track, this.stream);
        }
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
      console.log("[WebRTC] Enviando mensaje:", message.type);
      this.ws.send(JSON.stringify(message));
    } else {
      console.error("[WebRTC] WebSocket no está abierto al intentar enviar mensaje");
      this.handleReconnect();
    }
  }

  close() {
    console.log("[WebRTC] Cerrando conexión");
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.pc.close();
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}