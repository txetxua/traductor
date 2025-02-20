import { Express } from "express";
import { Server as SocketIOServer } from "socket.io";

var rooms = new Map();
var sseClients = new Map();

export function registerRoutes(app: Express, io: SocketIOServer) {
  console.log("[SocketIO] Server initialized");

  app.get("/api/translations/stream/:roomId", (req, res) => {
    try {
      const roomId = req.params.roomId;
      const language = req.query.language as string;

      if (!roomId || !language) {
        res.status(400).json({ error: "Room ID and language are required" });
        return;
      }

      console.log(`[Translations] Setting up SSE for room ${roomId}, language ${language}`);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type"
      });

      res.write(`event: connected\ndata: ${JSON.stringify({ type: "connected" })}\n\n`);

      if (!sseClients.has(roomId)) {
        sseClients.set(roomId, new Set());
      }
      sseClients.get(roomId)?.add({ res, language });

      console.log(`[Translations] Client connected to room ${roomId}`);

      const keepAlive = setInterval(() => {
        if (!res.writableEnded) {
          res.write(":\n\n");
        }
      }, 15000);

      req.on("close", () => {
        console.log(`[Translations] Client disconnected from room ${roomId}`);
        clearInterval(keepAlive);
        const clients = sseClients.get(roomId);
        if (clients) {
          clients.forEach((client: any) => {
            if (client.res === res) {
              clients.delete(client);
            }
          });
          if (clients.size === 0) {
            sseClients.delete(roomId);
          }
        }
      });
    } catch (error) {
      console.error("[Translations] Error setting up SSE:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  io.on("connection", (socket) => {
    console.log("[SocketIO] New connection:", socket.id);
    let currentRoom: string | null = null;

    socket.on("join", ({ roomId }) => {
      try {
        if (!roomId) {
          throw new Error("Room ID is required");
        }
        if (currentRoom) {
          socket.leave(currentRoom);
          const prevRoom = rooms.get(currentRoom);
          if (prevRoom) {
            prevRoom.delete(socket.id);
            if (prevRoom.size === 0) {
              rooms.delete(currentRoom);
            }
          }
        }

        currentRoom = roomId;
        socket.join(roomId);
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Set());
        }
        rooms.get(roomId)?.add(socket.id);

        console.log(`[SocketIO] Client ${socket.id} joined room ${roomId}`);
        socket.emit("joined", { clientId: socket.id, clients: rooms.get(roomId)?.size });
      } catch (error) {
        console.error("[SocketIO] Join error:", error);
        socket.emit("error", { message: error.message || "Error al unirse a la sala" });
      }
    });

    socket.on("signal", (message) => {
      if (!currentRoom) {
        socket.emit("error", { message: "Debe unirse a una sala primero" });
        return;
      }
      console.log(`[SocketIO] Broadcasting ${message.type} to room ${currentRoom}`);
      socket.to(currentRoom).emit("signal", message);
    });

    socket.on("disconnect", () => {
      if (currentRoom) {
        rooms.get(currentRoom)?.delete(socket.id);
        if (rooms.get(currentRoom)?.size === 0) {
          rooms.delete(currentRoom);
        }
        console.log(`[SocketIO] Client ${socket.id} left room ${currentRoom}`);
      }
    });
  });
}
