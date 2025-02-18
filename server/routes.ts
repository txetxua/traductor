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
    "adiós": "arrivederci",
    "¿qué tal?": "come va?",
    "mucho gusto": "piacere",
    "hasta luego": "a dopo",
    "bienvenido": "benvenuto",
    "perdón": "scusi",
    "lo siento": "mi dispiace",
    "de nada": "prego",
    "por supuesto": "certo"
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
    "arrivederci": "adiós",
    "come va?": "¿qué tal?",
    "piacere": "mucho gusto",
    "a dopo": "hasta luego",
    "benvenuto": "bienvenido",
    "scusi": "perdón",
    "mi dispiace": "lo siento",
    "prego": "de nada",
    "certo": "por supuesto"
  }
};

// Mejorada la función de traducción para simular mejor
const translateText = (text: string, from: string, to: string) => {
  // Si el idioma de origen y destino son iguales, no traducimos
  if (from === to) return text;

  // Simular traducción cambiando el texto según el idioma destino
  if (to === 'it') {
    // Traducir a italiano
    return text
      // Cambiar terminaciones comunes
      .replace(/ción/g, 'zione')
      .replace(/dad/g, 'tà')
      .replace(/ar$/g, 'are')
      .replace(/er$/g, 'ere')
      .replace(/ir$/g, 'ire')
      // Cambiar palabras comunes
      .replace(/el/g, 'il')
      .replace(/la/g, 'la')
      .replace(/los/g, 'i')
      .replace(/las/g, 'le')
      .replace(/es/g, 'è')
      .replace(/está/g, 'sta')
      .replace(/bien/g, 'bene')
      .replace(/mal/g, 'male')
      // Añadir prefijo para indicar que es una traducción
      .replace(/^/, '[IT] ');
  } else {
    // Traducir a español
    return text
      // Cambiar terminaciones comunes
      .replace(/zione/g, 'ción')
      .replace(/tà/g, 'dad')
      .replace(/are$/g, 'ar')
      .replace(/ere$/g, 'er')
      .replace(/ire$/g, 'ir')
      // Cambiar palabras comunes
      .replace(/il/g, 'el')
      .replace(/i /g, 'los ')
      .replace(/le /g, 'las ')
      .replace(/è/g, 'es')
      .replace(/sta/g, 'está')
      .replace(/bene/g, 'bien')
      .replace(/male/g, 'mal')
      // Añadir prefijo para indicar que es una traducción
      .replace(/^/, '[ES] ');
  }
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
        } else if (message.type === "translation" || message.type === "offer" ||
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