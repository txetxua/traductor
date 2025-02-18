import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { callStorage } from "./storage";
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

  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/ws',
    perMessageDeflate: false
  });

  console.log("[WebSocket] Server initialized on /ws");

  // SSE endpoint para traducciones
  app.get("/api/translations/stream/:roomId", (req, res) => {
    const roomId = req.params.roomId;
    const language = req.query.language as string;

    if (!roomId || !language || !["es", "it"].includes(language)) {
      console.log("[SSE] Invalid request:", { roomId, language });
      res.status(400).json({ error: "Invalid room ID or language" });
      return;
    }

    console.log(`[SSE] Client connected to room ${roomId} with language ${language}`);

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
      console.log(`[SSE] Client disconnected from room ${roomId}`);
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

  // Endpoint de traducción usando OpenAI
  app.post("/api/translate", async (req, res) => {
    console.log("[Translate] Request received:", req.body);
    try {
      const result = translateSchema.safeParse(req.body);
      if (!result.success) {
        console.error("[Translate] Invalid request:", result.error);
        return res.status(400).json({ error: "Invalid translation request" });
      }

      const { text, from, to, roomId } = result.data;
      console.log(`[Translate] Processing translation from ${from} to ${to} in room ${roomId}`);

      // Usar el nuevo servicio de traducción
      const translated = await translateText(text, from, to);
      console.log(`[Translate] Text translated: "${text}" -> "${translated}"`);

      const roomClients = sseClients.get(roomId);
      console.log(`[Translate] Room ${roomId} has ${roomClients?.size || 0} clients`);

      if (roomClients) {
        const message: TranslationMessage = {
          type: "translation",
          text,
          translated,
          from,
          to
        };

        let sentToSomeone = false;
        roomClients.forEach(client => {
          if (client.language === to) {
            try {
              console.log(`[Translate] Sending translation to client with language ${client.language}`);
              client.res.write(`data: ${JSON.stringify(message)}\n\n`);
              sentToSomeone = true;
            } catch (error) {
              console.error(`[Translate] Error sending to client:`, error);
            }
          } else {
            console.log(`[Translate] Skipping client with language ${client.language} (not target language ${to})`);
          }
        });

        console.log(`[Translate] Translation ${sentToSomeone ? 'was' : 'was not'} sent to any clients`);
      } else {
        console.log(`[Translate] No clients found in room ${roomId}`);
      }

      res.json({ translated });
    } catch (error) {
      console.error("[Translate] Error:", error);
      res.status(500).json({ error: "Translation failed" });
    }
  });

  // WebSocket handling
  wss.on("connection", (ws, req) => {
    console.log("[WebSocket] New connection from:", req.socket.remoteAddress);
    let currentRoom: string | null = null;

    const sendMessage = (message: WebSocketMessage | SignalingMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message));
        } catch (err) {
          console.error("[WebSocket] Error sending message:", err);
        }
      }
    };

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Message received:", message);

        if (message.type === "join") {
          if (!message.roomId) {
            sendMessage({ type: "error", error: "Room ID is required" });
            return;
          }

          if (!rooms.has(message.roomId)) {
            rooms.set(message.roomId, new Set());
          }

          const roomClients = rooms.get(message.roomId)!;
          roomClients.add(ws);
          currentRoom = message.roomId;

          console.log(`[WebSocket] Client joined room ${message.roomId}, total clients: ${roomClients.size}`);
          sendMessage({ type: "joined", roomId: message.roomId, clients: roomClients.size });
          return;
        }

        if (!currentRoom) {
          sendMessage({ type: "error", error: "Not in a room" });
          return;
        }

        if (["offer", "answer", "ice-candidate"].includes(message.type)) {
          const roomClients = rooms.get(currentRoom)!;
          console.log(`[WebSocket] Broadcasting ${message.type} in room ${currentRoom}`);

          roomClients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(JSON.stringify(message));
              } catch (err) {
                console.error("[WebSocket] Error broadcasting message:", err);
              }
            }
          });
        }
      } catch (error) {
        console.error("[WebSocket] Error processing message:", error);
        sendMessage({ type: "error", error: "Invalid message format" });
      }
    });

    ws.on("close", () => {
      if (currentRoom) {
        const roomClients = rooms.get(currentRoom);
        if (roomClients) {
          roomClients.delete(ws);
          console.log(`[WebSocket] Client left room ${currentRoom}, remaining: ${roomClients.size}`);
          if (roomClients.size === 0) {
            console.log(`[WebSocket] Removing empty room ${currentRoom}`);
            rooms.delete(currentRoom);
          }
        }
      }
    });

    ws.on("error", (error) => {
      console.error("[WebSocket] Connection error:", error);
      sendMessage({ type: "error", error: "WebSocket error occurred" });
    });
  });

  const rooms = new Map<string, Set<WebSocket>>();
  return httpServer;
}