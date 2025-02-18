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
    "por supuesto": "certo",
    "ver": "vedere",
    "hablar": "parlare",
    "entender": "capire",
    "escuchar": "ascoltare",
    "decir": "dire",
    "hacer": "fare",
    "querer": "volere",
    "poder": "potere",
    "tener": "avere",
    "estar": "stare",
    "ser": "essere",
    "ir": "andare",
    "venir": "venire",
    "salir": "uscire",
    "entrar": "entrare",
    "trabajar": "lavorare",
    "estudiar": "studiare",
    "vivir": "vivere",
    "comer": "mangiare",
    "beber": "bere",
    "dormir": "dormire",
    "despertar": "svegliare",
    "pensar": "pensare",
    "creer": "credere",
    "saber": "sapere",
    "conocer": "conoscere",
    "recordar": "ricordare",
    "olvidar": "dimenticare",
    "comenzar": "cominciare",
    "terminar": "finire",
    "ahora": "adesso",
    "después": "dopo",
    "antes": "prima",
    "siempre": "sempre",
    "nunca": "mai",
    "jamás": "mai",
    "aquí": "qui",
    "allí": "lì",
    "cerca": "vicino",
    "lejos": "lontano",
    "dentro": "dentro",
    "fuera": "fuori",
    "sobre": "su",
    "bajo": "sotto",
    "entre": "tra",
    "detrás": "dietro",
    "delante": "davanti",
    "todo": "tutto",
    "nada": "niente",
    "algo": "qualcosa",
    "alguien": "qualcuno",
    "nadie": "nessuno",
    "cada": "ogni",
    "mucho": "molto",
    "poco": "poco",
    "bastante": "abbastanza",
    "demasiado": "troppo",
    "más": "più",
    "menos": "meno",
    "mejor": "meglio",
    "peor": "peggio"
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
    "certo": "por supuesto",
    "vedere": "ver",
    "parlare": "hablar",
    "capire": "entender",
    "ascoltare": "escuchar",
    "dire": "decir",
    "fare": "hacer",
    "volere": "querer",
    "potere": "poder",
    "avere": "tener",
    "stare": "estar",
    "essere": "ser",
    "andare": "ir",
    "venire": "venir",
    "uscire": "salir",
    "entrare": "entrar",
    "lavorare": "trabajar",
    "studiare": "estudiar",
    "vivere": "vivir",
    "mangiare": "comer",
    "bere": "beber",
    "dormire": "dormir",
    "svegliare": "despertar",
    "pensare": "pensar",
    "credere": "creer",
    "sapere": "saber",
    "conoscere": "conocer",
    "ricordare": "recordar",
    "dimenticare": "olvidar",
    "cominciare": "comenzar",
    "finire": "terminar",
    "adesso": "ahora",
    "dopo": "después",
    "prima": "antes",
    "sempre": "siempre",
    "mai": "nunca",
    "qui": "aquí",
    "lì": "allí",
    "vicino": "cerca",
    "lontano": "lejos",
    "dentro": "dentro",
    "fuori": "fuera",
    "su": "sobre",
    "sotto": "bajo",
    "tra": "entre",
    "dietro": "detrás",
    "davanti": "delante",
    "tutto": "todo",
    "niente": "nada",
    "qualcosa": "algo",
    "qualcuno": "alguien",
    "nessuno": "nadie",
    "ogni": "cada",
    "molto": "mucho",
    "poco": "poco",
    "abbastanza": "bastante",
    "troppo": "demasiado",
    "più": "más",
    "meno": "menos",
    "meglio": "mejor",
    "peggio": "peor"
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
  const lowerText = text.toLowerCase().trim();

  // Primero intentar traducir la frase completa
  if (translations[from] && translations[from][lowerText]) {
    const translated = translations[from][lowerText];
    console.log(`[Translate] Traducción exacta encontrada: ${text} -> ${translated}`);
    return translated;
  }

  // Si no hay traducción exacta de la frase, traducir palabra por palabra
  const words = lowerText.split(/\s+/);
  const translatedWords = words.map(word => {
    const wordTranslation = translations[from]?.[word];
    if (wordTranslation) {
      console.log(`[Translate] Palabra traducida: ${word} -> ${wordTranslation}`);
      return wordTranslation;
    }
    // Si no encontramos traducción, aplicar reglas básicas de traducción italiano-español
    if (to === 'it') {
      return word
        .replace(/ción$/, 'zione')
        .replace(/dad$/, 'tà')
        .replace(/ar$/, 'are')
        .replace(/er$/, 'ere')
        .replace(/ir$/, 'ire');
    }
    return word;
  });

  const translated = translatedWords.join(' ');
  console.log(`[Translate] Traducción generada: ${text} -> ${translated}`);
  return translated;
};

export async function registerRoutes(app: Express): Promise<Server> {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
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

          // Usar Array.from para convertir el Set en un array antes de iterarlo
          Array.from(clientsInRoom).forEach(client => {
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