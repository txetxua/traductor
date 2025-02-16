import { type SignalingMessage } from "@shared/schema";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private ws: WebSocket;
  
  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void
  ) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    this.ws = new WebSocket(wsUrl);
    
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
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
      this.onRemoteStream(event.streams[0]);
    };

    this.pc.onconnectionstatechange = () => {
      this.onConnectionStateChange(this.pc.connectionState);
    };

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: "join", roomId }));
    };

    this.ws.onmessage = async (event) => {
      const message: SignalingMessage = JSON.parse(event.data);
      
      switch (message.type) {
        case "offer":
          await this.pc.setRemoteDescription(message.payload);
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.sendSignaling({
            type: "answer",
            payload: answer
          });
          break;
          
        case "answer":
          await this.pc.setRemoteDescription(message.payload);
          break;
          
        case "ice-candidate":
          await this.pc.addIceCandidate(message.payload);
          break;
      }
    };
  }

  async start(videoEnabled: boolean) {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: videoEnabled,
        audio: true
      });
      
      this.stream.getTracks().forEach(track => {
        if (this.stream) {
          this.pc.addTrack(track, this.stream);
        }
      });

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      
      this.sendSignaling({
        type: "offer",
        payload: offer
      });
      
      return this.stream;
    } catch (err) {
      console.error("Failed to start WebRTC:", err);
      throw err;
    }
  }

  private sendSignaling(message: SignalingMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.pc.close();
    this.ws.close();
  }
}
