import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc!: RTCPeerConnection;
  private stream?: MediaStream;
  private ws!: WebSocket;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout?: NodeJS.Timeout;

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
      console.log("[WebRTC] WebSocket conectado, uniéndose a sala:", this.roomId);
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
      this.reconnectAttempts = 0;
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }
    };

    this.ws.onclose = () => {
      console.log("[WebRTC] Conexión WebSocket cerrada");
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`[WebRTC] Intentando reconectar (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.reconnectTimeout = setTimeout(() => this.initializeWebSocket(), 2000);
      } else {
        this.onError(new Error("No se pudo mantener la conexión con el servidor"));
      }
    };

    this.ws.onerror = (error) => {
      console.error("[WebRTC] Error en WebSocket:", error);
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
      ],
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 10
    };

    this.pc = new RTCPeerConnection(configuration);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log("[WebRTC] Nuevo candidato ICE:", candidate);
        this.sendSignaling({
          type: "ice-candidate",
          payload: candidate
        });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      console.log("[WebRTC] Estado de conexión ICE cambiado a:", state);

      if (state === 'connected') {
        console.log("[WebRTC] Conexión ICE establecida exitosamente");
        this.onConnectionStateChange('connected');
      } else if (state === 'failed') {
        console.error("[WebRTC] Conexión ICE fallida");
        this.pc.restartIce();
      } else if (state === 'disconnected') {
        console.log("[WebRTC] ICE desconectado, intentando reconectar...");
        this.pc.restartIce();
      }
    };

    this.pc.ontrack = (event) => {
      console.log("[WebRTC] Track remoto recibido:", event.track.kind);
      const [remoteStream] = event.streams;
      if (remoteStream) {
        console.log("[WebRTC] Configurando stream remoto");
        this.onRemoteStream(remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      console.log("[WebRTC] Estado de conexión cambiado a:", state);
      this.onConnectionStateChange(state);

      if (state === 'connected') {
        console.log("[WebRTC] Conexión establecida exitosamente");
        this.reconnectAttempts = 0;
      } else if (state === 'failed') {
        console.error("[WebRTC] Conexión fallida");
        this.restartConnection();
      } else if (state === 'disconnected') {
        console.log("[WebRTC] Conexión desconectada, intentando reconectar...");
        this.restartConnection();
      }
    };
  }

  private async handleWebSocketMessage(event: MessageEvent) {
    try {
      const message: SignalingMessage = JSON.parse(event.data);
      console.log("[WebRTC] Mensaje WebSocket recibido:", message.type);

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
          console.log("[WebRTC] Procesando candidato ICE");
          if (this.pc.remoteDescription) {
            await this.pc.addIceCandidate(new RTCIceCandidate(message.payload));
          }
          break;
      }
    } catch (err) {
      console.error("[WebRTC] Error procesando mensaje WebSocket:", err);
      this.onError(err as Error);
    }
  }

  private async restartConnection() {
    console.log("[WebRTC] Reiniciando conexión");
    try {
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);
      this.sendSignaling({
        type: "offer",
        payload: offer
      });
    } catch (error) {
      console.error("[WebRTC] Error al reiniciar conexión:", error);
      this.onError(error as Error);
    }
  }

  async start(videoEnabled: boolean) {
    try {
      console.log("[WebRTC] Iniciando conexión con video:", videoEnabled);

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

      console.log("[WebRTC] Solicitando acceso a medios con restricciones:", constraints);
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      console.log("[WebRTC] Acceso a medios concedido:", {
        video: this.stream.getVideoTracks().length > 0,
        audio: this.stream.getAudioTracks().length > 0
      });

      this.stream.getTracks().forEach(track => {
        console.log("[WebRTC] Añadiendo track a conexión peer:", track.kind);
        if (this.stream) {
          this.pc.addTrack(track, this.stream);
        }
      });

      console.log("[WebRTC] Creando y enviando oferta");
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
      console.log("[WebRTC] Enviando mensaje de señalización:", message.type);
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn("[WebRTC] WebSocket no está abierto, mensaje no enviado:", message.type);
    }
  }

  close() {
    console.log("[WebRTC] Cerrando conexión");
    this.stream?.getTracks().forEach(track => {
      console.log("[WebRTC] Deteniendo track:", track.kind);
      track.stop();
    });
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.pc.close();
    this.ws.close();
  }
}