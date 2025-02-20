import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { registerRoutes } from "./routes";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Configuración de CORS para permitir conexiones desde el frontend en Vercel
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Crear servidor HTTP y WebSockets
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: "*" },
  path: "/socket.io"
});

// Registrar rutas y WebSockets
registerRoutes(app, io);

// Iniciar servidor en Railway
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend corriendo en: http://localhost:${PORT}`);
  console.log(`✅ WebSockets en ws://localhost:${PORT}/socket.io`);
});
