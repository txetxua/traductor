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

const translateText = (text: string, from: string, to: string) => {
  console.log(`[Translate] Traduciendo: "${text}" de ${from} a ${to}`);

  // Si el idioma de origen y destino son iguales, no traducimos
  if (from === to) {
    console.log("[Translate] Mismo idioma, retornando texto original");
    return text;
  }

  // Normalizar el texto a minúsculas para mejor coincidencia
  const lowerText = text.toLowerCase();

  // Buscar traducciones exactas primero
  if (translations[from] && translations[from][lowerText]) {
    const translated = translations[from][lowerText];
    console.log(`[Translate] Traducción exacta encontrada: ${text} -> ${translated}`);
    return translated;
  }

  // Si no hay traducción exacta, aplicar reglas de traducción
  let translated = to === 'it' ? 
    // Traducir a italiano
    text
      .replace(/ción/g, 'zione')
      .replace(/dad/g, 'tà')
      .replace(/ar$/g, 'are')
      .replace(/er$/g, 'ere')
      .replace(/ir$/g, 'ire')
      .replace(/el/g, 'il')
      .replace(/la/g, 'la')
      .replace(/los/g, 'i')
      .replace(/las/g, 'le')
      .replace(/es/g, 'è')
      .replace(/está/g, 'sta')
      .replace(/bien/g, 'bene')
      .replace(/mal/g, 'male')
    :
    // Traducir a español
    text
      .replace(/zione/g, 'ción')
      .replace(/tà/g, 'dad')
      .replace(/are$/g, 'ar')
      .replace(/ere$/g, 'er')
      .replace(/ire$/g, 'ir')
      .replace(/il/g, 'el')
      .replace(/i /g, 'los ')
      .replace(/le /g, 'las ')
      .replace(/è/g, 'es')
      .replace(/sta/g, 'está')
      .replace(/bene/g, 'bien')
      .replace(/male/g, 'mal');

  console.log(`[Translate] Traducción generada: ${text} -> ${translated}`);
  return translated;
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
      console.log(`[Translate] Texto traducido: "${text}" (${from}) -> "${translated}" (${to})`);
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

    console.log("[WebSocket] Nueva conexión establecida");

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Mensaje recibido:", message.type, "para sala:", currentRoom);

        if (message.type === "join") {
          const roomId = message.roomId;
          currentRoom = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
            console.log(`[WebSocket] Nueva sala creada: ${roomId}`);
          }
          rooms.get(roomId)!.add(ws);
          console.log(`[WebSocket] Cliente añadido a sala ${roomId}. Total clientes: ${rooms.get(roomId)!.size}`);
        } else if (message.type === "translation" || message.type === "offer" ||
          message.type === "answer" || message.type === "ice-candidate") {

          if (!currentRoom || !rooms.has(currentRoom)) {
            console.warn("[WebSocket] Cliente no está en ninguna sala");
            return;
          }

          const clientsInRoom = rooms.get(currentRoom)!;
          console.log(`[WebSocket] Enviando mensaje tipo ${message.type} a ${clientsInRoom.size - 1} clientes en sala ${currentRoom}`);

          if (message.type === "translation") {
            // Para mensajes de traducción, asegurarse de que el receptor reciba la traducción
            const translationMsg = message as TranslationMessage;
            console.log(`[WebSocket] Mensaje de traducción: ${translationMsg.text} -> ${translationMsg.translated}`);
          }

          for (const client of clientsInRoom) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(data.toString());
            }
          }
        }
      } catch (err) {
        console.error("[WebSocket] Error procesando mensaje:", err);
      }
    });

    ws.on("close", () => {
      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
        console.log(`[WebSocket] Cliente desconectado de sala ${currentRoom}. Quedan ${rooms.get(currentRoom)!.size} clientes`);

        if (rooms.get(currentRoom)!.size === 0) {
          rooms.delete(currentRoom);
          console.log(`[WebSocket] Sala ${currentRoom} eliminada por no tener clientes`);
        }
      }
    });

    ws.on("error", (error) => {
      console.error("[WebSocket] Error en conexión:", error);
    });
  });

  return httpServer;
}