import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc!: RTCPeerConnection;
  private stream?: MediaStream;
  private pollingInterval: number | null = null;
  private hasSentOffer = false;
  private pendingIceCandidates: RTCIceCandidate[] = [];
  private isSettingRemoteDescription = false;

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
      console.log("[WebRTC] Handling signal:", message.type, "Connection state:", this.pc.connectionState, "Signaling state:", this.pc.signalingState);

      if (message.type === "offer") {
        await this.handleOffer(message);
      } else if (message.type === "answer") {
        await this.handleAnswer(message);
      } else if (message.type === "ice-candidate" && message.payload) {
        await this.handleIceCandidate(message.payload);
      }
    } catch (error) {
      console.error("[WebRTC] Error handling signal:", error);
      this.onError(error as Error);
    }
  }

  private async handleOffer(message: SignalingMessage) {
    if (this.pc.signalingState === "stable" || this.pc.signalingState === "have-remote-offer") {
      this.isSettingRemoteDescription = true;
      try {
        await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
        console.log("[WebRTC] Remote description (offer) set");

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        console.log("[WebRTC] Local description (answer) set");

        await this.sendSignal({
          type: "answer",
          payload: answer
        });

        // Process any pending ICE candidates
        await this.processPendingIceCandidates();
      } finally {
        this.isSettingRemoteDescription = false;
      }
    } else {
      console.log("[WebRTC] Ignoring offer in state:", this.pc.signalingState);
    }
  }

  private async handleAnswer(message: SignalingMessage) {
    if (!this.hasSentOffer) {
      console.log("[WebRTC] Ignoring answer - no offer sent");
      return;
    }

    if (this.pc.signalingState === "have-local-offer") {
      this.isSettingRemoteDescription = true;
      try {
        await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
        console.log("[WebRTC] Remote description (answer) set");
        this.hasSentOffer = false;

        // Process any pending ICE candidates
        await this.processPendingIceCandidates();
      } finally {
        this.isSettingRemoteDescription = false;
      }
    } else {
      console.log("[WebRTC] Ignoring answer in state:", this.pc.signalingState);
    }
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (this.isSettingRemoteDescription) {
      // Queue the candidate if we're in the middle of setting remote description
      this.pendingIceCandidates.push(new RTCIceCandidate(candidate));
      console.log("[WebRTC] ICE candidate queued");
    } else if (this.pc.remoteDescription) {
      try {
        await this.pc.addIceCandidate(candidate);
        console.log("[WebRTC] ICE candidate added");
      } catch (error) {
        console.error("[WebRTC] Error adding ICE candidate:", error);
        this.onError(error as Error);
      }
    } else {
      this.pendingIceCandidates.push(new RTCIceCandidate(candidate));
      console.log("[WebRTC] ICE candidate queued (no remote description)");
    }
  }

  private async processPendingIceCandidates() {
    if (this.pendingIceCandidates.length > 0) {
      console.log("[WebRTC] Processing pending ICE candidates:", this.pendingIceCandidates.length);
      while (this.pendingIceCandidates.length) {
        const candidate = this.pendingIceCandidates.shift();
        if (candidate) {
          try {
            await this.pc.addIceCandidate(candidate);
            console.log("[WebRTC] Pending ICE candidate added");
          } catch (error) {
            console.error("[WebRTC] Error adding pending ICE candidate:", error);
            this.onError(error as Error);
          }
        }
      }
    }
  }

  private async sendSignal(message: SignalingMessage) {
    try {
      if (message.type === "offer") {
        this.hasSentOffer = true;
      }

      const response = await fetch(`${this.getApiBaseUrl()}/api/signal/${this.roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        throw new Error(`Failed to send signal: ${response.status}`);
      }

      console.log("[WebRTC] Signal sent:", message.type);
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
      ],
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
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
        if (this.hasSentOffer || this.pc.signalingState !== "stable") {
          console.log("[WebRTC] Negotiation needed but not in stable state or offer already sent");
          return;
        }

        console.log("[WebRTC] Creating offer");
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        console.log("[WebRTC] Local description set");

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