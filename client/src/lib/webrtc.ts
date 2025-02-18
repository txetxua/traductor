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
    console.log("[WebRTC] Initializing for room:", roomId);
    this.initializePeerConnection();
    this.initializeWebSocket();
  }

  private initializeWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log("[WebRTC] Connecting to WebSocket:", wsUrl);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("[WebRTC] WebSocket connected");
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
    };

    this.ws.onclose = () => {
      console.log("[WebRTC] WebSocket closed");
      this.onError(new Error("WebSocket connection closed"));
    };

    this.ws.onerror = (error) => {
      console.error("[WebRTC] WebSocket error:", error);
      this.onError(new Error("WebSocket connection error"));
    };

    this.ws.onmessage = this.handleWebSocketMessage.bind(this);
  }

  private async handleWebSocketMessage(event: MessageEvent) {
    try {
      const message: SignalingMessage = JSON.parse(event.data);
      console.log("[WebRTC] Message received:", message.type);

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
            try {
              await this.pc.addIceCandidate(message.payload);
            } catch (err) {
              console.error("[WebRTC] Error adding ICE candidate:", err);
            }
          }
          break;
      }
    } catch (err) {
      console.error("[WebRTC] Error processing message:", err);
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
        this.sendSignaling({
          type: "offer",
          payload: offer
        });
      } catch (err) {
        console.error("[WebRTC] Negotiation error:", err);
        this.onError(err as Error);
      }
    };
  }

  private sendSignaling(message: SignalingMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        console.log("[WebRTC] Sending message:", message.type);
        this.ws.send(JSON.stringify(message));
      } catch (err) {
        console.error("[WebRTC] Error sending message:", err);
        this.onError(err as Error);
      }
    } else {
      console.error("[WebRTC] WebSocket not open");
      this.onError(new Error("WebSocket not connected"));
    }
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
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}