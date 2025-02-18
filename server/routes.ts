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

// Diccionario simplificado para traducciones comunes
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

// Función simplificada de traducción
const translateText = (text: string, from: string, to: string): string => {
  if (from === to) return text;

  const phrases = text.toLowerCase().split(/[.!?]+/).filter(Boolean);
  const translatedPhrases = phrases.map(phrase => {
    const trimmedPhrase = phrase.trim();
    if (translations[from]?.[trimmedPhrase]) {
      return translations[from][trimmedPhrase];
    }
    return trimmedPhrase;
  });

  return translatedPhrases.join(". ").trim();
};

export async function registerRoutes(app: Express): Promise<Server> {
  // CORS middleware
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // API endpoints
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

  // WebSocket server
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const rooms = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws) => {
    let currentRoom: string | null = null;
    console.log("[WebSocket] New connection established");

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "join") {
          const roomId = message.roomId;
          currentRoom = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
            console.log(`[WebSocket] New room created: ${roomId}`);
          }
          rooms.get(roomId)!.add(ws);
          console.log(`[WebSocket] Client added to room ${roomId}. Total clients: ${rooms.get(roomId)!.size}`);

        } else if (!currentRoom || !rooms.has(currentRoom)) {
          console.warn("[WebSocket] Client not in any room");
          return;

        } else if (message.type === "translation") {
          const translationMsg = message as TranslationMessage;
          const clientsInRoom = rooms.get(currentRoom)!;

          console.log(`[WebSocket] Processing translation:`, {
            from: translationMsg.from,
            text: translationMsg.text,
            translated: translationMsg.translated,
            clientsInRoom: clientsInRoom.size
          });

          // Save translation to database
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

          // Send to all except sender
          clientsInRoom.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              console.log(`[WebSocket] Sending translation to client in room ${currentRoom}`);
              client.send(JSON.stringify(translationMsg));
            }
          });

        } else if (message.type === "offer" || message.type === "answer" || message.type === "ice-candidate") {
          const signalMsg = message as SignalingMessage;
          const clientsInRoom = rooms.get(currentRoom)!;

          console.log(`[WebSocket] Sending ${signalMsg.type} signal to other clients`);

          clientsInRoom.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(data.toString());
            }
          });
        }
      } catch (err) {
        console.error("[WebSocket] Error processing message:", err);
      }
    });

    ws.on("close", () => {
      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
        console.log(`[WebSocket] Client disconnected from room ${currentRoom}. Remaining clients: ${rooms.get(currentRoom)!.size}`);

        if (rooms.get(currentRoom)!.size === 0) {
          rooms.delete(currentRoom);
          console.log(`[WebSocket] Room ${currentRoom} deleted as it has no clients`);
        }
      }
    });

    ws.on("error", (error) => {
      console.error("[WebSocket] Connection error:", error);
    });
  });

  return httpServer;
}