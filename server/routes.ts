import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { callStorage } from "./storage";
import { z } from "zod";
import { insertCallSchema, type SignalingMessage, type TranslationMessage } from "@shared/schema";

const translateSchema = z.object({
  text: z.string(),
  from: z.enum(["es", "it"]),
  to: z.enum(["es", "it"])
});

// Common translations dictionary
const translations = {
  "es": {
    "hola": "ciao",
    "buenos días": "buongiorno",
    "gracias": "grazie",
    "por favor": "per favore",
    "sí": "sì",
    "no": "no",
    "adiós": "arrivederci",
    "hasta luego": "a dopo",
    "¿cómo estás?": "come stai?",
    "bien": "bene",
    "mal": "male",
    "no entiendo": "non capisco",
    "¿puedes repetir?": "puoi ripetere?",
    "más despacio": "più lentamente",
    "entiendo": "capisco"
  },
  "it": {
    "ciao": "hola",
    "buongiorno": "buenos días",
    "grazie": "gracias",
    "per favore": "por favor",
    "sì": "sí",
    "no": "no",
    "arrivederci": "adiós",
    "a dopo": "hasta luego",
    "come stai?": "¿cómo estás?",
    "bene": "bien",
    "male": "mal",
    "non capisco": "no entiendo",
    "puoi ripetere?": "¿puedes repetir?",
    "più lentamente": "más despacio",
    "capisco": "entiendo"
  }
};

// Simple translation function
const translateText = (text: string, from: string, to: string): string => {
  if (from === to) return text;

  const phrases = text.toLowerCase().split(/[.!?]+/).filter(Boolean);
  const translatedPhrases = phrases.map(phrase => {
    const trimmedPhrase = phrase.trim();
    return translations[from as keyof typeof translations][trimmedPhrase] || trimmedPhrase;
  });

  return translatedPhrases.join(". ").trim();
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Enable CORS specifically for WebSocket upgrade
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Upgrade, Connection');
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    next();
  });

  app.post("/api/calls", async (req, res) => {
    const result = insertCallSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: "Invalid call data" });
    }
    const call = await callStorage.createCall(result.data);
    res.json(call);
  });

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
      res.json({ translated });
    } catch (error) {
      console.error("[Translate] Error:", error);
      res.status(500).json({ error: "Translation failed" });
    }
  });

  // Create HTTP server
  const httpServer = createServer(app);

  // WebSocket server setup
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    perMessageDeflate: false, // Disable compression for better performance
    clientTracking: true
  });

  // Track rooms and their clients
  const rooms = new Map<string, Set<WebSocket>>();

  // WebSocket server events
  wss.on("connection", (ws, req) => {
    console.log("[WebSocket] New connection from:", req.socket.remoteAddress);
    let currentRoom: string | null = null;

    // Set up ping-pong
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Message received:", message.type);

        if (message.type === "join") {
          const roomId = message.roomId;
          currentRoom = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
            console.log(`[WebSocket] New room created: ${roomId}`);
          }

          rooms.get(roomId)!.add(ws);
          console.log(`[WebSocket] Client joined room ${roomId}. Total clients: ${rooms.get(roomId)!.size}`);

          // Send acknowledgment
          ws.send(JSON.stringify({ type: "joined", roomId }));

        } else if (!currentRoom || !rooms.has(currentRoom)) {
          console.warn("[WebSocket] Client not in any room");
          ws.send(JSON.stringify({ type: "error", error: "Not in a room" }));
          return;

        } else if (message.type === "translation") {
          const translationMsg = message as TranslationMessage;
          const clientsInRoom = rooms.get(currentRoom)!;

          console.log(`[WebSocket] Processing translation in room ${currentRoom}:`, {
            from: translationMsg.from,
            text: translationMsg.text,
            translated: translationMsg.translated,
            recipients: clientsInRoom.size - 1
          });

          // Save translation to database
          try {
            const call = await callStorage.getCall(currentRoom);
            if (call) {
              await callStorage.createTranslation({
                callId: call.id,
                sourceText: translationMsg.text,
                translatedText: translationMsg.translated,
                fromLanguage: translationMsg.from,
                toLanguage: translationMsg.from === "es" ? "it" : "es"
              });
            }
          } catch (error) {
            console.error("[WebSocket] Error saving translation:", error);
          }

          // Broadcast to other clients in the room
          clientsInRoom.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(JSON.stringify(translationMsg));
              } catch (error) {
                console.error("[WebSocket] Error sending translation:", error);
              }
            }
          });
        } else if (message.type === "offer" || message.type === "answer" || message.type === "ice-candidate") {
          const signalMsg = message as SignalingMessage;
          const clientsInRoom = rooms.get(currentRoom)!;

          console.log(`[WebSocket] Broadcasting ${signalMsg.type} in room ${currentRoom}`);

          clientsInRoom.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(data.toString());
              } catch (error) {
                console.error("[WebSocket] Error sending signal:", error);
              }
            }
          });
        }
      } catch (error) {
        console.error("[WebSocket] Error processing message:", error);
        ws.send(JSON.stringify({ type: "error", error: "Invalid message format" }));
      }
    });

    ws.on("close", () => {
      clearInterval(pingInterval);

      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
        console.log(`[WebSocket] Client left room ${currentRoom}. Remaining clients: ${rooms.get(currentRoom)!.size}`);

        if (rooms.get(currentRoom)!.size === 0) {
          rooms.delete(currentRoom);
          console.log(`[WebSocket] Room ${currentRoom} deleted (empty)`);
        }
      }
    });

    ws.on("error", (error) => {
      console.error("[WebSocket] Error:", error);
    });

    ws.on("pong", () => {
      // Connection is alive
      console.debug("[WebSocket] Pong received from client");
    });
  });

  // Handle WebSocket server errors
  wss.on("error", (error) => {
    console.error("[WebSocket Server] Error:", error);
  });

  return httpServer;
}