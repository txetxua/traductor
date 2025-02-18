import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { callStorage } from "./storage";
import { z } from "zod";
import { insertCallSchema, type SignalingMessage, type TranslationMessage } from "@shared/schema";

// Translation schemas and dictionaries remain unchanged
const translateSchema = z.object({
  text: z.string(),
  from: z.enum(["es", "it"]),
  to: z.enum(["es", "it"])
});

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
  const phrases = text.toLowerCase().split(/[.!?]+/).filter(Boolean);
  const translatedPhrases = phrases.map(phrase => {
    const trimmedPhrase = phrase.trim();
    const dict = from === "es" ? translations.es : translations.it;
    return dict[trimmedPhrase as keyof typeof dict] || trimmedPhrase;
  });
  return translatedPhrases.join(". ").trim();
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Map to store SSE clients for each room
  const sseClients = new Map<string, Set<{
    send: (data: string) => void;
    language: string;
  }>>();

  // SSE endpoint for translations
  app.get("/api/translations/stream/:roomId", (req, res) => {
    const roomId = req.params.roomId;
    const language = req.query.language as string;

    if (!roomId || !language || !["es", "it"].includes(language)) {
      res.status(400).json({ error: "Invalid room ID or language" });
      return;
    }

    console.log(`[SSE] New client connected to room ${roomId} with language ${language}`);

    // Set headers for SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    // Create client handler
    const client = {
      send: (data: string) => {
        res.write(`data: ${data}\n\n`);
      },
      language
    };

    // Add client to room
    if (!sseClients.has(roomId)) {
      sseClients.set(roomId, new Set());
    }
    sseClients.get(roomId)!.add(client);

    // Send initial connection confirmation
    client.send(JSON.stringify({ type: "connected" }));

    // Handle client disconnect
    req.on("close", () => {
      console.log(`[SSE] Client disconnected from room ${roomId}`);
      sseClients.get(roomId)?.delete(client);
      if (sseClients.get(roomId)?.size === 0) {
        sseClients.delete(roomId);
      }
    });
  });

  // Translation endpoint now broadcasts to SSE clients
  app.post("/api/translate", async (req, res) => {
    console.log("[Translate] Request received:", req.body);
    const result = translateSchema.safeParse(req.body);
    if (!result.success) {
      console.error("[Translate] Validation error:", result.error);
      return res.status(400).json({ error: "Invalid translation request" });
    }

    try {
      const { text, from, to } = result.data;
      const translated = translateText(text, from, to);
      console.log(`[Translate] Text translated: "${text}" -> "${translated}"`);

      // Broadcast translation to all SSE clients in the room
      const roomClients = sseClients.get(req.body.roomId);
      if (roomClients) {
        const message = JSON.stringify({
          type: "translation",
          text,
          translated,
          from,
          to
        });

        roomClients.forEach(client => {
          // Only send to clients with the target language
          if (client.language === to) {
            client.send(message);
          }
        });
      }

      res.json({ translated });
    } catch (error) {
      console.error("[Translate] Error:", error);
      res.status(500).json({ error: "Translation failed" });
    }
  });

  const httpServer = createServer(app);

  // Simplified WebSocket server setup for signaling only
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws"
  });

  console.log("[WebSocket] Server initialized on /ws");

  const rooms = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws) => {
    console.log("[WebSocket] New connection");
    let currentRoom: string | null = null;

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Message received:", message);

        if (message.type === "join" && message.roomId) {
          currentRoom = message.roomId;
          if (!rooms.has(currentRoom)) {
            rooms.set(currentRoom, new Set());
          }
          rooms.get(currentRoom)!.add(ws);
          console.log(`[WebSocket] Client joined room ${currentRoom}`);
          ws.send(JSON.stringify({ type: "joined", roomId: currentRoom }));
          return;
        }

        // Only handle signaling messages if client is in a room
        if (!currentRoom) {
          ws.send(JSON.stringify({ type: "error", error: "Not in a room" }));
          return;
        }

        // Forward signaling messages to other clients in the room
        if (["offer", "answer", "ice-candidate"].includes(message.type)) {
          rooms.get(currentRoom)!.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(data.toString());
            }
          });
        }
      } catch (error) {
        console.error("[WebSocket] Error processing message:", error);
        ws.send(JSON.stringify({ type: "error", error: "Invalid message format" }));
      }
    });

    ws.on("close", () => {
      if (currentRoom) {
        rooms.get(currentRoom)?.delete(ws);
        if (rooms.get(currentRoom)?.size === 0) {
          rooms.delete(currentRoom);
        }
      }
    });
  });

  return httpServer;
}