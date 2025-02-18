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
  // Configure CORS for both HTTP and WebSocket
  app.use((req, res, next) => {
    const origin = req.headers.origin || '*';
    console.log("[Server] Incoming request:", {
      method: req.method,
      path: req.path,
      origin: req.headers.origin,
      upgrade: req.headers.upgrade,
      host: req.headers.host
    });

    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
      console.log("[Server] Detected WebSocket upgrade request");
      res.header('Access-Control-Allow-Headers', 'Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Extensions');
      res.header('Access-Control-Allow-Origin', '*');
    }

    if (req.method === 'OPTIONS') {
      console.log("[Server] Handling OPTIONS request");
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

  // WebSocket server setup with improved error handling and new path
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/socket", // Changed from /ws to /socket
    perMessageDeflate: false,
    clientTracking: true,
    handleProtocols: (protocols) => {
      console.log("[WebSocket] Protocols requested:", protocols);
      return protocols ? protocols[0] : '';
    }
  });

  console.log("[WebSocket] Server initialized with path: /socket");

  // Track rooms and their clients
  const rooms = new Map<string, Set<WebSocket>>();

  // WebSocket server events
  wss.on("connection", (ws, req) => {
    console.log("[WebSocket] Nueva conexión entrante:", {
      address: req.socket.remoteAddress,
      headers: {
        upgrade: req.headers.upgrade,
        connection: req.headers.connection,
        host: req.headers.host,
        origin: req.headers.origin
      }
    });
    let currentRoom: string | null = null;

    // Set up ping-pong with shorter interval for faster connection status detection
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch (error) {
          console.error("[WebSocket] Error en ping:", error);
          clearInterval(pingInterval);
          ws.terminate();
        }
      }
    }, 15000);

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Mensaje recibido:", message.type);

        if (message.type === "join") {
          const roomId = message.roomId;
          currentRoom = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
            console.log(`[WebSocket] Nueva sala creada: ${roomId}`);
          }

          rooms.get(roomId)!.add(ws);
          console.log(`[WebSocket] Cliente unido a sala ${roomId}. Total clientes: ${rooms.get(roomId)!.size}`);

          // Send acknowledgment
          ws.send(JSON.stringify({ type: "joined", roomId }));

        } else if (!currentRoom || !rooms.has(currentRoom)) {
          console.warn("[WebSocket] Cliente no está en ninguna sala");
          ws.send(JSON.stringify({ type: "error", error: "No está en una sala" }));
          return;
        } else if (message.type === "translation") {
          const translationMsg = message as TranslationMessage;
          const clientsInRoom = rooms.get(currentRoom)!;

          console.log(`[WebSocket] Procesando traducción en sala ${currentRoom}:`, {
            from: translationMsg.from,
            text: translationMsg.text,
            translated: translationMsg.translated,
            recipients: clientsInRoom.size - 1
          });

          // Broadcast to other clients in the room
          clientsInRoom.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(JSON.stringify(translationMsg));
              } catch (error) {
                console.error("[WebSocket] Error enviando traducción:", error);
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
        console.error("[WebSocket] Error procesando mensaje:", error);
        ws.send(JSON.stringify({ type: "error", error: "Formato de mensaje inválido" }));
      }
    });

    ws.on("close", () => {
      clearInterval(pingInterval);

      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
        console.log(`[WebSocket] Cliente dejó sala ${currentRoom}. Clientes restantes: ${rooms.get(currentRoom)!.size}`);

        if (rooms.get(currentRoom)!.size === 0) {
          rooms.delete(currentRoom);
          console.log(`[WebSocket] Sala ${currentRoom} eliminada (vacía)`);
        }
      }
    });

    ws.on("error", (error) => {
      console.error("[WebSocket] Error:", error);
    });

    ws.on("pong", () => {
      // Connection is alive
      console.debug("[WebSocket] Pong recibido del cliente");
    });
  });

  // Handle WebSocket server errors
  wss.on("error", (error) => {
    console.error("[WebSocket Server] Error:", {
      error,
      message: error.message,
      stack: error.stack
    });
  });

  wss.on("listening", () => {
    console.log("[WebSocket] Server is listening");
  });

  return httpServer;
}