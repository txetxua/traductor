import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private pollingInterval: number | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private isConnected = false;

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
      if (!this.isConnected) {
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
        }
      }
    }, 1000) as unknown as number;
  }

  private async handleSignalingMessage(message: SignalingMessage) {
    try {
      console.log("[WebRTC] Received signal:", message.type, "State:", this.pc.signalingState);

      switch (message.type) {
        case "offer":
          await this.handleOffer(message.payload);
          break;
        case "answer":
          await this.handleAnswer(message.payload);
          break;
        case "ice-candidate":
          if (message.payload) {
            await this.handleIceCandidate(message.payload);
          }
          break;
      }
    } catch (error) {
      console.error("[WebRTC] Error handling signal:", error);
      this.onError(error as Error);
    }
  }

  private async handleOffer(offer: RTCSessionDescriptionInit) {
    try {
      if (this.pc.signalingState !== "stable") {
        console.log("[WebRTC] Cannot handle offer in state:", this.pc.signalingState);
        return;
      }

      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log("[WebRTC] Remote description set (offer)");

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      console.log("[WebRTC] Local description set (answer)");

      await this.sendSignal({ type: "answer", payload: answer });

      // Add any pending candidates
      await this.processPendingCandidates();
    } catch (error) {
      console.error("[WebRTC] Error handling offer:", error);
      this.onError(error as Error);
    }
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit) {
    try {
      if (this.pc.signalingState !== "have-local-offer") {
        console.log("[WebRTC] Cannot handle answer in state:", this.pc.signalingState);
        return;
      }

      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      console.log("[WebRTC] Remote description set (answer)");

      // Add any pending candidates
      await this.processPendingCandidates();
    } catch (error) {
      console.error("[WebRTC] Error handling answer:", error);
      this.onError(error as Error);
    }
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    try {
      if (!this.pc.remoteDescription) {
        console.log("[WebRTC] Queuing ICE candidate");
        this.pendingCandidates.push(candidate);
        return;
      }

      await this.pc.addIceCandidate(candidate);
      console.log("[WebRTC] ICE candidate added");
    } catch (error) {
      console.error("[WebRTC] Error adding ICE candidate:", error);
    }
  }

  private async processPendingCandidates() {
    console.log("[WebRTC] Processing pending candidates:", this.pendingCandidates.length);
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (candidate) {
        try {
          await this.pc.addIceCandidate(candidate);
          console.log("[WebRTC] Pending ICE candidate added");
        } catch (error) {
          console.error("[WebRTC] Error adding pending ICE candidate:", error);
        }
      }
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
    const config: RTCConfiguration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    };

    this.pc = new RTCPeerConnection(config);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.sendSignal({
          type: "ice-candidate",
          payload: candidate
        }).catch(console.error);
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
      console.log("[WebRTC] Connection state changed to:", this.pc.connectionState);
      this.onConnectionStateChange(this.pc.connectionState);

      if (this.pc.connectionState === 'connected') {
        this.isConnected = true;
      } else if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
        this.isConnected = false;
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        if (this.pc.signalingState === "stable") {
          console.log("[WebRTC] Creating offer");
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          await this.sendSignal({
            type: "offer",
            payload: offer
          });
        }
      } catch (error) {
        console.error("[WebRTC] Error during negotiation:", error);
        this.onError(error as Error);
      }
    };
  }

  async start(stream: MediaStream) {
    try {
      this.stream = stream;
      this.stream.getTracks().forEach(track => {
        if (this.stream) {
          console.log("[WebRTC] Adding track:", track.kind);
          this.pc.addTrack(track, this.stream);
        }
      });
    } catch (error) {
      console.error("[WebRTC] Error starting:", error);
      this.onError(error as Error);
      throw error;
    }
  }

  close() {
    console.log("[WebRTC] Closing connection");
    this.isConnected = false;

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }

    this.pc.close();

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}