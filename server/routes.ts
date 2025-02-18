import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { 
  type WebSocketMessage, 
  type SignalingMessage,
  type TranslationMessage 
} from "@shared/schema";
import { translateText } from "./translation-service";

const translateSchema = z.object({
  text: z.string(),
  from: z.enum(["es", "it"]),
  to: z.enum(["es", "it"]),
  roomId: z.string()
});

export async function registerRoutes(app: Express): Promise<Server> {
  const sseClients = new Map<string, Set<{
    res: any;
    language: string;
    keepAliveInterval?: NodeJS.Timeout;
  }>>();

  const httpServer = createServer(app);
  const rooms = new Map<string, Set<WebSocket>>();

  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/ws',
    clientTracking: true,
    perMessageDeflate: false
  });

  wss.on("error", (error) => {
    console.error("[WebSocket Server] Error:", error);
  });

  console.log("[WebSocket] Server initialized on /ws");

  wss.on("connection", (ws, req) => {
    // Log detailed connection information
    console.log("[WebSocket] New connection details:", {
      headers: req.headers,
      url: req.url,
      remoteAddress: req.socket.remoteAddress
    });

    ws.on("error", (error) => {
      console.error("[WebSocket] Client error:", error);
    });

    let currentRoom: string | null = null;
    let pingInterval: NodeJS.Timeout;

    // Set up ping interval
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on("pong", () => {
      console.log("[WebSocket] Client is alive");
    });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Message received:", message);

        if (message.type === "join") {
          if (!message.roomId) {
            ws.send(JSON.stringify({ type: "error", error: "Room ID required" }));
            return;
          }

          // Leave previous room if any
          if (currentRoom) {
            const oldRoom = rooms.get(currentRoom);
            if (oldRoom) {
              oldRoom.delete(ws);
              if (oldRoom.size === 0) {
                rooms.delete(currentRoom);
              }
            }
          }

          // Join new room
          if (!rooms.has(message.roomId)) {
            rooms.set(message.roomId, new Set());
          }

          const roomClients = rooms.get(message.roomId)!;
          roomClients.add(ws);
          currentRoom = message.roomId;

          console.log(`[WebSocket] Client joined room ${message.roomId}, total clients: ${roomClients.size}`);

          // Send joined confirmation
          ws.send(JSON.stringify({ 
            type: "joined", 
            roomId: message.roomId,
            clients: roomClients.size 
          }));
          return;
        }

        if (!currentRoom) {
          ws.send(JSON.stringify({ type: "error", error: "Not in a room" }));
          return;
        }

        // Handle WebRTC signaling messages
        if (["offer", "answer", "ice-candidate"].includes(message.type)) {
          const roomClients = rooms.get(currentRoom);
          if (!roomClients) {
            console.error("[WebSocket] Room not found:", currentRoom);
            return;
          }

          // Broadcast to other clients in the room
          roomClients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(message));
            }
          });
        }

      } catch (error) {
        console.error("[WebSocket] Error processing message:", error);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "error", error: "Invalid message format" }));
        }
      }
    });

    ws.on("close", () => {
      clearInterval(pingInterval);

      if (currentRoom) {
        const roomClients = rooms.get(currentRoom);
        if (roomClients) {
          roomClients.delete(ws);
          console.log(`[WebSocket] Client left room ${currentRoom}, remaining: ${roomClients.size}`);
          if (roomClients.size === 0) {
            rooms.delete(currentRoom);
          }
        }
      }
    });
  });

  app.get("/api/translations/stream/:roomId", (req, res) => {
    const roomId = req.params.roomId;
    const language = req.query.language as string;

    if (!roomId || !language || !["es", "it"].includes(language)) {
      res.status(400).json({ error: "Invalid room ID or language" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    const keepAliveInterval = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 30000);

    if (!sseClients.has(roomId)) {
      sseClients.set(roomId, new Set());
    }

    const client = { res, language, keepAliveInterval };
    sseClients.get(roomId)!.add(client);

    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    req.on("close", () => {
      clearInterval(keepAliveInterval);
      const roomClients = sseClients.get(roomId);
      if (roomClients) {
        roomClients.delete(client);
        if (roomClients.size === 0) {
          sseClients.delete(roomId);
        }
      }
    });
  });

  app.post("/api/translate", async (req, res) => {
    try {
      const result = translateSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid translation request" });
      }

      const { text, from, to, roomId } = result.data;
      console.log(`[Translate] Processing translation from ${from} to ${to}`);

      const translated = await translateText(text, from, to);
      console.log(`[Translate] Text translated: "${text}" -> "${translated}"`);

      const roomClients = sseClients.get(roomId);
      if (roomClients) {
        const message: TranslationMessage = {
          type: "translation",
          text,
          translated,
          from,
          to
        };

        roomClients.forEach(client => {
          client.res.write(`data: ${JSON.stringify(message)}\n\n`);
        });
      }

      res.json({ translated });
    } catch (error) {
      console.error("[Translate] Error:", error);
      res.status(500).json({ error: "Translation failed" });
    }
  });

  return httpServer;
}