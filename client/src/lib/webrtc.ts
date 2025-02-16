import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private ws: WebSocket;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.sendSignaling({
          type: "ice-candidate",
          payload: candidate
        });
      }
    };

    this.pc.ontrack = (event) => {
      console.log("Received remote track", event.streams[0]);
      this.onRemoteStream(event.streams[0]);
    };

    this.pc.onconnectionstatechange = () => {
      console.log("Connection state changed:", this.pc.connectionState);
      this.onConnectionStateChange(this.pc.connectionState);
    };

    this.ws.onopen = () => {
      console.log("WebSocket connected, joining room:", roomId);
      this.ws.send(JSON.stringify({ type: "join", roomId }));
    };

    this.ws.onmessage = async (event) => {
      const message: SignalingMessage = JSON.parse(event.data);

      try {
        switch (message.type) {
          case "offer":
            console.log("Received offer");
            await this.pc.setRemoteDescription(message.payload);
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.sendSignaling({
              type: "answer",
              payload: answer
            });
            break;

          case "answer":
            console.log("Received answer");
            await this.pc.setRemoteDescription(message.payload);
            break;

          case "ice-candidate":
            console.log("Received ICE candidate");
            await this.pc.addIceCandidate(message.payload);
            break;
        }
      } catch (err) {
        console.error("Error processing WebSocket message:", err);
        this.onError(err as Error);
      }
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.onError(new Error("WebSocket connection failed"));
    };
  }

  async start(videoEnabled: boolean) {
    try {
      console.log("Requesting media access...");
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: videoEnabled,
        audio: true
      });

      console.log("Got local stream:", this.stream);
      this.stream.getTracks().forEach(track => {
        if (this.stream) {
          console.log("Adding track to peer connection:", track.kind);
          this.pc.addTrack(track, this.stream);
        }
      });

      const offer = await this.pc.createOffer();
      console.log("Created offer:", offer);
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
    this.stream?.getTracks().forEach(track => track.stop());
    this.pc.close();
    this.ws.close();
  }
}