import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { callStorage } from "./storage";
import { z } from "zod";
import { insertCallSchema, type SignalingMessage, type TranslationMessage } from "@shared/schema";

// Translation schema
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
} as const;

// Simple translation function
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
  // Configure CORS for both HTTP and WebSocket
  app.use((req, res, next) => {
    console.log("[Server] Incoming request:", {
      method: req.method,
      path: req.path,
      origin: req.headers.origin,
      upgrade: req.headers.upgrade,
      host: req.headers.host
    });

    // Allow all origins for WebSocket connections
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Origin, Authorization, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Extensions');
      res.setHeader('Access-Control-Allow-Credentials', 'true');

      if (req.method === 'OPTIONS') {
        return res.status(200).end();
      }
    } else {
      // Regular HTTP requests
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');

      if (req.method === 'OPTIONS') {
        return res.status(200).end();
      }
    }

    next();
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
    path: "/socket",
    perMessageDeflate: false,
    clientTracking: true
  });

  console.log("[WebSocket] Server inicializado en /socket");

  const rooms = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws, req) => {
    console.log("[WebSocket] Nueva conexión entrante:", {
      address: req.socket.remoteAddress,
      url: req.url,
      origin: req.headers.origin,
      host: req.headers.host
    });

    let currentRoom: string | null = null;
    let lastHeartbeat = Date.now();

    const heartbeatCheck = setInterval(() => {
      const now = Date.now();
      if (now - lastHeartbeat > 60000) { // 60 segundos sin heartbeat
        console.log("[WebSocket] Cliente inactivo, cerrando conexión");
        ws.terminate();
        clearInterval(heartbeatCheck);
      }
    }, 30000);

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Mensaje recibido:", message.type);

        if (message.type === "heartbeat") {
          lastHeartbeat = Date.now();
          return;
        }

        if (message.type === "join") {
          const roomId = message.roomId;
          currentRoom = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
          }

          rooms.get(roomId)!.add(ws);
          console.log(`[WebSocket] Cliente unido a sala ${roomId}. Total clientes: ${rooms.get(roomId)!.size}`);

          ws.send(JSON.stringify({ type: "joined", roomId }));
          return;
        }

        if (!currentRoom || !rooms.has(currentRoom)) {
          console.log("[WebSocket] Cliente intentó enviar mensaje sin estar en una sala");
          ws.send(JSON.stringify({ type: "error", error: "No está en una sala" }));
          return;
        }

        // Broadcast message to other clients in the room
        const clientsInRoom = rooms.get(currentRoom)!;
        clientsInRoom.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(data.toString());
            } catch (error) {
              console.error("[WebSocket] Error enviando mensaje:", error);
            }
          }
        });

      } catch (error) {
        console.error("[WebSocket] Error procesando mensaje:", error);
        ws.send(JSON.stringify({ type: "error", error: "Error en el formato del mensaje" }));
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeatCheck);
      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
        console.log(`[WebSocket] Cliente dejó sala ${currentRoom}. Clientes restantes: ${rooms.get(currentRoom)!.size}`);

        if (rooms.get(currentRoom)!.size === 0) {
          rooms.delete(currentRoom);
        }
      }
    });

    ws.on("error", (error) => {
      console.error("[WebSocket] Error en la conexión:", error);
    });
  });

  wss.on("error", (error) => {
    console.error("[WebSocket] Error en el servidor:", error);
  });

  return httpServer;
}