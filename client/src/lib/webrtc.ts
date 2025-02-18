import { type SignalingMessage } from "@shared/schema";
import { WebSocketHandler } from "./websocket";

export class WebRTCConnection {
  private pc!: RTCPeerConnection;
  private stream?: MediaStream;
  private ws: WebSocketHandler;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    console.log("[WebRTC] Initializing for room:", roomId);
    this.initializePeerConnection();

    // Inicializar WebSocket con manejo asíncrono
    this.ws = new WebSocketHandler(roomId, (error) => {
      console.error("[WebRTC] WebSocket error:", error);
      this.onError(error);
    });

    // Configurar handlers de mensajes WebSocket
    this.setupWebSocketHandlers();
  }

  private setupWebSocketHandlers() {
    this.ws.onMessage("offer", async (message) => {
      try {
        await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.ws.send({
          type: "answer",
          payload: answer
        });
      } catch (err) {
        console.error("[WebRTC] Error handling offer:", err);
        this.onError(err as Error);
      }
    });

    this.ws.onMessage("answer", async (message) => {
      try {
        await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
      } catch (err) {
        console.error("[WebRTC] Error handling answer:", err);
        this.onError(err as Error);
      }
    });

    this.ws.onMessage("ice-candidate", async (message) => {
      if (message.payload) {
        try {
          await this.pc.addIceCandidate(message.payload);
        } catch (err) {
          console.error("[WebRTC] Error adding ICE candidate:", err);
          this.onError(err as Error);
        }
      }
    });
  }

  private initializePeerConnection() {
    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    };

    this.pc = new RTCPeerConnection(configuration);

    this.pc.onicecandidate = async ({ candidate }) => {
      if (candidate) {
        try {
          await this.ws.send({
            type: "ice-candidate",
            payload: candidate
          });
        } catch (err) {
          console.error("[WebRTC] Error sending ICE candidate:", err);
          this.onError(err as Error);
        }
      }
    };

    this.pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        console.log("[WebRTC] Remote stream received");
        this.onRemoteStream(remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", this.pc.connectionState);
      this.onConnectionStateChange(this.pc.connectionState);

      if (this.pc.connectionState === 'failed') {
        this.onError(new Error("WebRTC connection failed"));
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        await this.ws.send({
          type: "offer",
          payload: offer
        });
      } catch (err) {
        console.error("[WebRTC] Negotiation error:", err);
        this.onError(err as Error);
      }
    };
  }

  async start(stream: MediaStream) {
    try {
      console.log("[WebRTC] Starting with stream");
      this.stream = stream;

      this.stream.getTracks().forEach(track => {
        if (this.stream) {
          console.log("[WebRTC] Adding track:", track.kind);
          this.pc.addTrack(track, this.stream);
        }
      });

    } catch (err) {
      console.error("[WebRTC] Error starting:", err);
      this.onError(err as Error);
      throw err;
    }
  }

  close() {
    console.log("[WebRTC] Closing connection");
    this.stream?.getTracks().forEach(track => track.stop());
    this.pc.close();
    this.ws.close();
  }
}