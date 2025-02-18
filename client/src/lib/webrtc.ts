import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc!: RTCPeerConnection;
  private stream?: MediaStream;
  private pollingInterval: number | null = null;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    console.log("[WebRTC] Initializing for room:", roomId);
    this.initializePeerConnection();
    this.startPolling();
  }

  private getApiBaseUrl(): string {
    return window.location.origin;
  }

  private async startPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.pollingInterval = window.setInterval(async () => {
      try {
        const response = await fetch(`${this.getApiBaseUrl()}/api/signal/${this.roomId}`);
        if (!response.ok) {
          throw new Error(`Polling failed: ${response.status}`);
        }

        const messages: SignalingMessage[] = await response.json();
        for (const message of messages) {
          await this.handleSignalingMessage(message);
        }
      } catch (error) {
        console.error("[WebRTC] Polling error:", error);
        this.onError(error as Error);
      }
    }, 1000) as unknown as number;
  }

  private async handleSignalingMessage(message: SignalingMessage) {
    try {
      if (message.type === "offer") {
        await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.sendSignal({
          type: "answer",
          payload: answer
        });
      } else if (message.type === "answer") {
        await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
      } else if (message.type === "ice-candidate" && message.payload) {
        await this.pc.addIceCandidate(message.payload);
      }
    } catch (error) {
      console.error("[WebRTC] Error handling signal:", error);
      this.onError(error as Error);
    }
  }

  private async sendSignal(message: SignalingMessage) {
    try {
      const response = await fetch(`${this.getApiBaseUrl()}/api/signal/${this.roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        throw new Error(`Failed to send signal: ${response.status}`);
      }
    } catch (error) {
      console.error("[WebRTC] Error sending signal:", error);
      this.onError(error as Error);
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

    this.pc.onicecandidate = async ({ candidate }) => {
      if (candidate) {
        try {
          await this.sendSignal({
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
        await this.sendSignal({
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

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}