import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private ws: WebSocket;
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
    console.log("Connecting to WebSocket:", wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("WebSocket connected, joining room:", this.roomId);
      this.ws.send(JSON.stringify({ type: "join", roomId: this.roomId }));
      this.reconnectAttempts = 0;
    };

    this.ws.onclose = () => {
      console.log("WebSocket connection closed");
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.initializeWebSocket(), 2000);
      } else {
        this.onError(new Error("No se pudo reconectar al servidor"));
      }
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.onError(new Error("Error en la conexión con el servidor"));
    };

    this.ws.onmessage = this.handleWebSocketMessage.bind(this);
  }

  private initializePeerConnection() {
    console.log("Initializing RTCPeerConnection");

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
        console.log("New ICE candidate:", candidate);
        this.sendSignaling({
          type: "ice-candidate",
          payload: candidate
        });
      }
    };

    this.pc.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind);
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.onRemoteStream(remoteStream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log("Connection state changed:", this.pc.connectionState);
      this.onConnectionStateChange(this.pc.connectionState);

      if (this.pc.connectionState === 'failed') {
        this.onError(new Error("La conexión con el otro participante ha fallado"));
      }
    };

    this.pc.onicegatheringstatechange = () => {
      console.log("ICE gathering state:", this.pc.iceGatheringState);
    };

    this.pc.onsignalingstatechange = () => {
      console.log("Signaling state:", this.pc.signalingState);
    };
  }

  private async handleWebSocketMessage(event: MessageEvent) {
    try {
      const message: SignalingMessage = JSON.parse(event.data);
      console.log("Received WebSocket message:", message.type);

      switch (message.type) {
        case "offer":
          console.log("Processing offer");
          await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.sendSignaling({
            type: "answer",
            payload: answer
          });
          break;

        case "answer":
          console.log("Processing answer");
          await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          break;

        case "ice-candidate":
          console.log("Processing ICE candidate");
          if (this.pc.remoteDescription) {
            await this.pc.addIceCandidate(new RTCIceCandidate(message.payload));
          }
          break;
      }
    } catch (err) {
      console.error("Error processing WebSocket message:", err);
      this.onError(err as Error);
    }
  }

  async start(videoEnabled: boolean) {
    try {
      console.log("Starting WebRTC connection...");

      const constraints = {
        video: videoEnabled ? {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } : false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      };

      console.log("Requesting media with constraints:", constraints);
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      console.log("Media access granted:", 
        `video: ${this.stream.getVideoTracks().length > 0}`,
        `audio: ${this.stream.getAudioTracks().length > 0}`
      );

      this.stream.getTracks().forEach(track => {
        console.log("Adding track to peer connection:", track.kind);
        if (this.stream) {
          this.pc.addTrack(track, this.stream);
        }
      });

      console.log("Creating and setting local description");
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      this.sendSignaling({
        type: "offer",
        payload: offer
      });

      return this.stream;
    } catch (err) {
      console.error("Failed to start WebRTC:", err);
      this.onError(err as Error);
      throw err;
    }
  }

  private sendSignaling(message: SignalingMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      console.log("Sending signaling message:", message.type);
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket not open, message not sent:", message.type);
    }
  }

  close() {
    console.log("Closing WebRTC connection");
    this.stream?.getTracks().forEach(track => {
      console.log("Stopping track:", track.kind);
      track.stop();
    });
    this.pc.close();
    this.ws.close();
  }
}