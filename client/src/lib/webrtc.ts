export class WebRTCConnection {
  private pc: RTCPeerConnection;
  private socket: Socket;

  constructor() {
    this.pc = new RTCPeerConnection();
    this.socket = io("https://mi-backend.railway.app"); // Asegurar que use la URL correcta
  }

  close() {
    console.log("[WebRTC] Closing connection");
    this.pc.close();
    this.socket.disconnect();
  }
} // <- Esta llave es importante
