import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc!: RTCPeerConnection;
  private stream?: MediaStream;
  private ws!: WebSocket;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout?: NodeJS.Timeout;
  private isInitiator: boolean = false;

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
      this.reconnectAttempts = 0;
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
    };

    this.ws.onclose = () => {
      console.log("[WebRTC] WebSocket cerrado");
      this.handleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error("[WebRTC] Error en WebSocket:", error);
      this.onError(new Error("Error en la conexión con el servidor"));
    };

    this.ws.onmessage = this.handleWebSocketMessage.bind(this);
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[WebRTC] Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }

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
      console.log("[WebRTC] Mensaje recibido:", message.type, "Estado actual:", this.pc.signalingState);

      switch (message.type) {
        case "offer":
          if (this.pc.signalingState !== "stable") {
            console.log("[WebRTC] Rollback necesario, estado actual:", this.pc.signalingState);
            await Promise.all([
              this.pc.setLocalDescription({type: "rollback"}),
              this.pc.setRemoteDescription(new RTCSessionDescription(message.payload))
            ]);
          } else {
            await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          }

          console.log("[WebRTC] Oferta establecida, creando respuesta");
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);

          this.sendSignaling({
            type: "answer",
            payload: answer
          });
          break;

        case "answer":
          console.log("[WebRTC] Procesando respuesta en estado:", this.pc.signalingState);
          if (this.pc.signalingState === "have-local-offer") {
            await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          } else {
            console.warn("[WebRTC] Ignorando respuesta en estado incorrecto:", this.pc.signalingState);
          }
          break;

        case "ice-candidate":
          try {
            if (this.pc.remoteDescription) {
              await this.pc.addIceCandidate(new RTCIceCandidate(message.payload));
              console.log("[WebRTC] Candidato ICE agregado exitosamente");
            } else {
              console.log("[WebRTC] Guardando candidato ICE para más tarde - sin descripción remota");
            }
          } catch (err) {
            console.warn("[WebRTC] Error al agregar candidato ICE:", err);
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
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
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
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require"
    };

    if (this.pc) {
      this.pc.close();
    }

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

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      console.log("[WebRTC] Estado de conexión ICE:", state);

      if (state === 'failed' || state === 'disconnected') {
        console.log("[WebRTC] Reintentando conexión ICE...");
        this.pc.restartIce();
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

      if (state === 'failed') {
        this.handleReconnect();
      }
    };
  }

  async start(videoEnabled: boolean) {
    try {
      console.log("[WebRTC] Iniciando con video:", videoEnabled);
      this.isInitiator = true;

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

      if (this.isInitiator) {
        console.log("[WebRTC] Creando oferta como iniciador");
        const offer = await this.pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });

        console.log("[WebRTC] Estado antes de establecer oferta local:", this.pc.signalingState);
        await this.pc.setLocalDescription(offer);

        this.sendSignaling({
          type: "offer",
          payload: offer
        });
      }

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