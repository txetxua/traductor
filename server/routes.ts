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

// Simulación básica de traducción para pruebas
const translateText = (text: string, from: string, to: string) => {
  // Palabras comunes en español e italiano para simular traducción
  const translations: Record<string, Record<string, string>> = {
    es: {
      "hola": "ciao",
      "buenos días": "buongiorno",
      "gracias": "grazie",
      "por favor": "per favore",
      "sí": "sì",
      "no": "no",
      "¿cómo estás?": "come stai?",
      "bien": "bene",
      "mal": "male",
      "adiós": "arrivederci"
    },
    it: {
      "ciao": "hola",
      "buongiorno": "buenos días",
      "grazie": "gracias",
      "per favore": "por favor",
      "sì": "sí",
      "no": "no",
      "come stai?": "¿cómo estás?",
      "bene": "bien",
      "male": "mal",
      "arrivederci": "adiós"
    }
  };

  // Convertir el texto a minúsculas para la búsqueda
  const lowerText = text.toLowerCase();

  // Buscar y reemplazar palabras conocidas
  let translated = lowerText;
  Object.entries(translations[from] || {}).forEach(([key, value]) => {
    const regex = new RegExp(key, 'gi');
    translated = translated.replace(regex, value);
  });

  // Si no se encontró ninguna traducción, simular una traducción
  if (translated === lowerText) {
    return `[${to.toUpperCase()}] ${text}`;
  }

  // Capitalizar la primera letra de la traducción
  return translated.charAt(0).toUpperCase() + translated.slice(1);
};

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/calls", async (req, res) => {
    const result = insertCallSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: "Invalid call data" });
    }

    const call = await callStorage.createCall(result.data);
    res.json(call);
  });

  app.post("/api/translate", async (req, res) => {
    console.log("[Translate] Solicitud recibida:", req.body);
    const result = translateSchema.safeParse(req.body);
    if (!result.success) {
      console.error("[Translate] Error de validación:", result.error);
      return res.status(400).json({ error: "Invalid translation request" });
    }

    try {
      const { text, from, to } = result.data;
      const translated = translateText(text, from, to);
      console.log(`[Translate] ${text} (${from}) -> ${translated} (${to})`);
      res.json({ translated });
    } catch (error) {
      console.error("[Translate] Error:", error);
      res.status(500).json({ error: "Translation failed" });
    }
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const rooms = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws) => {
    let currentRoom: string | null = null;

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Mensaje recibido:", message.type);

        if (message.type === "join") {
          const roomId = message.roomId;
          currentRoom = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
          }
          rooms.get(roomId)!.add(ws);
        } 
        else if (message.type === "translation" || message.type === "offer" || 
                 message.type === "answer" || message.type === "ice-candidate") {
          if (!currentRoom || !rooms.has(currentRoom)) {
            console.warn("[WebSocket] Cliente no está en ninguna sala");
            return;
          }

          const clientsInRoom = rooms.get(currentRoom)!;
          clientsInRoom.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(data.toString());
            }
          });
        }
      } catch (err) {
        console.error("[WebSocket] Error procesando mensaje:", err);
      }
    });

    ws.on("close", () => {
      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
        if (rooms.get(currentRoom)!.size === 0) {
          rooms.delete(currentRoom);
        }
      }
    });
  });

  return httpServer;
}