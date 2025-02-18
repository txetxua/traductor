import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { callStorage } from "./storage";
import { z } from "zod";
import { 
  insertCallSchema, 
  type WebSocketMessage, 
  type SignalingMessage, 
  type TranslationMessage 
} from "@shared/schema";

const translateSchema = z.object({
  text: z.string(),
  from: z.enum(["es", "it"]),
  to: z.enum(["es", "it"]),
  roomId: z.string()
});

// Diccionario de traducciones básicas
const translations = {
  "es": {
    "hola": "ciao",
    "buenos días": "buongiorno",
    "gracias": "grazie",
    "por favor": "per favore",
    "sí": "sì",
    "no": "no",
    "adiós": "arrivederci"
  },
  "it": {
    "ciao": "hola",
    "buongiorno": "buenos días",
    "grazie": "gracias",
    "per favore": "por favor",
    "sì": "sí",
    "no": "no",
    "arrivederci": "adiós"
  }
} as const;

const translateText = (text: string, from: string, to: string): string => {
  if (from === to) return text;

  // Traducir palabra por palabra usando el diccionario
  const words = text.toLowerCase().split(/\s+/);
  const translatedWords = words.map(word => {
    const dict = from === "es" ? translations.es : translations.it;
    return dict[word as keyof typeof dict] || word;
  });

  return translatedWords.join(" ");
};

export async function registerRoutes(app: Express): Promise<Server> {
  const sseClients = new Map<string, Set<{
    res: any;
    language: string;
    keepAliveInterval?: NodeJS.Timeout;
  }>>();

  // Configurar servidor HTTP
  const httpServer = createServer(app);

  // Configurar WebSocket Server
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

    // Enviar mensaje inicial de conexión
    const initialMessage = JSON.stringify({ type: "connected" });
    res.write(`data: ${initialMessage}\n\n`);

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

  // Endpoint de traducción
  app.post("/api/translate", async (req, res) => {
    console.log("[Translate] Request received:", req.body);
    try {
      const result = translateSchema.safeParse(req.body);
      if (!result.success) {
        console.error("[Translate] Invalid request:", result.error);
        return res.status(400).json({ error: "Invalid translation request" });
      }

      const { text, from, to, roomId } = result.data;
      const translated = translateText(text, from, to);
      console.log(`[Translate] Text translated: "${text}" -> "${translated}"`);

      const roomClients = sseClients.get(roomId);
      console.log(`[Translate] Room clients for ${roomId}:`, roomClients?.size);

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

  // Manejo de conexiones WebSocket
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

    const handleJoin = (roomId: string) => {
      if (!rooms.has(roomId)) {
        console.log("[WebSocket] Creating new room:", roomId);
        rooms.set(roomId, new Set());
      }

      const roomClients = rooms.get(roomId)!;
      roomClients.add(ws);
      currentRoom = roomId;

      console.log(`[WebSocket] Client joined room ${roomId}, total clients: ${roomClients.size}`);
      sendMessage({ type: "joined", roomId, clients: roomClients.size });
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
          handleJoin(message.roomId);
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