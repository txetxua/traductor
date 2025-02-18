import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { callStorage } from "./storage";
import { z } from "zod";
import { insertCallSchema, type SignalingMessage, type TranslationMessage } from "@shared/schema";

// Schemas para validación de mensajes
const messageSchema = z.object({
  type: z.enum(["heartbeat", "join", "translation", "offer", "answer", "ice-candidate"]),
  roomId: z.string().optional(),
  text: z.string().optional(),
  from: z.enum(["es", "it"]).optional(),
  translated: z.string().optional(),
  payload: z.any().optional()
});

// Schema para traducción
const translateSchema = z.object({
  text: z.string(),
  from: z.enum(["es", "it"]),
  to: z.enum(["es", "it"])
});

// Diccionario simple de traducciones
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

// Función simple de traducción
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

  const httpServer = createServer(app);
  const rooms = new Map<string, Set<WebSocket>>();

  // Configuración del servidor WebSocket
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    perMessageDeflate: false
  });

  console.log("[WebSocket] Servidor inicializado en /ws");

  wss.on("connection", (ws, req) => {
    console.log("[WebSocket] Nueva conexión entrante");
    let currentRoom: string | null = null;

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Mensaje recibido:", message);

        // Validar formato del mensaje
        const result = messageSchema.safeParse(message);
        if (!result.success) {
          console.error("[WebSocket] Error de validación:", result.error);
          ws.send(JSON.stringify({ type: "error", error: "Formato de mensaje inválido" }));
          return;
        }

        // Procesar mensaje según su tipo
        if (message.type === "join" && message.roomId) {
          currentRoom = message.roomId;

          if (!rooms.has(currentRoom)) {
            rooms.set(currentRoom, new Set());
          }
          rooms.get(currentRoom)!.add(ws);

          console.log(`[WebSocket] Cliente unido a sala ${currentRoom}. Total clientes: ${rooms.get(currentRoom)!.size}`);
          ws.send(JSON.stringify({ type: "joined", roomId: currentRoom }));
          return;
        }

        // Para otros tipos de mensajes, verificar que el cliente esté en una sala
        if (!currentRoom || !rooms.has(currentRoom)) {
          ws.send(JSON.stringify({ type: "error", error: "No está en una sala" }));
          return;
        }

        // Transmitir mensaje a otros clientes en la misma sala
        const clientsInRoom = rooms.get(currentRoom)!;
        clientsInRoom.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(data.toString());
          }
        });

      } catch (error) {
        console.error("[WebSocket] Error procesando mensaje:", error);
        ws.send(JSON.stringify({ type: "error", error: "Error en el formato del mensaje" }));
      }
    });

    ws.on("close", () => {
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

  return httpServer;
}