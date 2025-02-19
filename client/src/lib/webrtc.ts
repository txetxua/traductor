import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private pollingInterval: number | null = null;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
      ]
    };

    this.pc = new RTCPeerConnection(config);
    this.setupPeerConnection();
    this.startPolling();
  }

  private setupPeerConnection() {
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.sendSignal({
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
      this.onConnectionStateChange(this.pc.connectionState);
    };
  }

  private async startPolling() {
    this.pollingInterval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/signal/${this.roomId}`);
        if (!response.ok) return;

        const messages: SignalingMessage[] = await response.json();
        for (const message of messages) {
          await this.handleSignal(message);
        }
      } catch (error) {
        console.error("[WebRTC] Polling error:", error);
      }
    }, 1000) as unknown as number;
  }

  private async handleSignal(message: SignalingMessage) {
    try {
      switch (message.type) {
        case "offer":
          if (this.pc.signalingState === "stable") {
            await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            await this.sendSignal({ type: "answer", payload: answer });
          }
          break;

        case "answer":
          if (this.pc.signalingState === "have-local-offer") {
            await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
          }
          break;

        case "ice-candidate":
          if (this.pc.remoteDescription && message.payload) {
            await this.pc.addIceCandidate(message.payload);
          }
          break;
      }
    } catch (error) {
      console.error("[WebRTC] Signal error:", error);
      this.onError(error as Error);
    }
  }

  private async sendSignal(message: SignalingMessage) {
    try {
      await fetch(`/api/signal/${this.roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message)
      });
    } catch (error) {
      console.error("[WebRTC] Send signal error:", error);
      this.onError(error as Error);
    }
  }

  async start(stream: MediaStream) {
    this.stream = stream;
    this.stream.getTracks().forEach(track => {
      if (this.stream) {
        this.pc.addTrack(track, this.stream);
      }
    });

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.sendSignal({ type: "offer", payload: offer });
  }

  close() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.pc.close();
  }
}