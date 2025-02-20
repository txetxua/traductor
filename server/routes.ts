import { Server as SocketIOServer } from "socket.io";
import { Request, Response } from "express";

const rooms = new Map<string, Set<string>>();
const translations = new Map<string, Map<string, string>>();
const sseClients = new Map<string, Set<{ res: Response; language: string }>>();

export function registerRoutes(app: any, io: SocketIOServer) {
  console.log("[SocketIO] Server initialized");

  // 🔹 **API SSE para recibir traducciones en tiempo real**
  app.get("/api/translations/stream/:roomId", (req: Request, res: Response) => {
    try {
      const roomId = req.params.roomId;
      const language = req.query.language as string;

      if (!roomId || !language) {
        return res.status(400).json({ error: "Room ID and language are required" });
      }

      console.log(`[Translations] Setting up SSE for room ${roomId}, language ${language}`);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
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
          clients.forEach((client) => {
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
      const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
      res.status(500).json({ error: errorMessage });
    }
  });

  // 🔹 **API para enviar traducciones**
  app.post("/api/translate", async (req: Request, res: Response) => {
    try {
      const { text, from, to, roomId } = req.body;
      if (!text || !from || !to || !roomId) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      console.log(`[Translations] Translation request:`, { text, from, to, roomId });

      const translatedText = `[${to.toUpperCase()}] ${text}`;

      if (!translations.has(roomId)) {
        translations.set(roomId, new Map());
      }
      translations.get(roomId)?.set(text, translatedText);

      const clients = sseClients.get(roomId);
      if (clients) {
        const message = { type: "translation", text, translated: translatedText, from, to };
        console.log(`[Translations] Broadcasting to ${clients.size} clients:`, message);

        clients.forEach((client) => {
          if (!client.res.writableEnded) {
            client.res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
          }
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Translations] Translation error:", error);
      const errorMessage = error instanceof Error ? error.message : "Translation failed";
      res.status(500).json({ error: errorMessage });
    }
  });

  // 🔹 **WebSockets para conexión de clientes**
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
        const errorMessage = error instanceof Error ? error.message : "Error al unirse a la sala";
        socket.emit("error", { message: errorMessage });
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
