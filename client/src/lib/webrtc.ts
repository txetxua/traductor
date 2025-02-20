import { io, type Socket } from "socket.io-client";
import { type SignalingMessage } from "@shared/schema";

const API_URL = import.meta.env.VITE_API_URL || "https://tu-backend.railway.app";

export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private stream?: MediaStream;
  private socket: Socket;

  constructor(
    private roomId: string,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionStateChange: (state: RTCPeerConnectionState) => void,
    private onError: (error: Error) => void
  ) {
    console.log("[WebRTC] Initializing for room:", roomId);

    this.socket = io(API_URL, {
      path: "/socket.io",
      reconnection: true,
      transports: ["websocket"],
    });

    this.setupPeerConnection();
    this.setupSocketEvents();
  }
