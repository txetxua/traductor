import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { registerRoutes } from "./routes";

const app = express();
const PORT = process.env.PORT || 5000;

// Configurar CORS para permitir conexiones desde el frontend en Vercel
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: "*" },
  path: "/socket.io"
});

registerRoutes(app, io);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend en ejecución en: http://localhost:${PORT}`);
  console.log(`✅ WebSockets disponibles en ws://localhost:${PORT}/socket.io`);
});
