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
    const result = translateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: "Invalid translation request" });
    }

    try {
      // Implementación temporal de traducción
      const { text, from, to } = result.data;
      let translated = text;

      // Simular traducción básica para pruebas
      if (from === "es" && to === "it") {
        translated = `[IT] ${text}`;
      } else if (from === "it" && to === "es") {
        translated = `[ES] ${text}`;
      }

      console.log(`Traducción: ${text} (${from}) -> ${translated} (${to})`);
      res.json({ translated });
    } catch (error) {
      console.error("Translation error:", error);
      res.status(500).json({ error: "Translation failed" });
    }
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  // Track connected clients by room
  const rooms = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws) => {
    let currentRoom: string | null = null;

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Mensaje recibido:", message.type, "para sala:", message.roomId || currentRoom);

        if (message.type === "join") {
          const roomId = message.roomId;
          currentRoom = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
          }
          rooms.get(roomId)!.add(ws);

          console.log(`[WebSocket] Cliente conectado a sala ${roomId}. Total clientes: ${rooms.get(roomId)!.size}`);
        } 
        else if (message.type === "translation" || message.type === "offer" || 
                 message.type === "answer" || message.type === "ice-candidate") {
          if (!currentRoom || !rooms.has(currentRoom)) {
            console.log(`[WebSocket] Error: cliente no está en ninguna sala`);
            return;
          }

          const clientsInRoom = rooms.get(currentRoom)!;
          console.log(`[WebSocket] Enviando mensaje ${message.type} a ${clientsInRoom.size - 1} otros clientes en sala ${currentRoom}`);

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
          console.log(`[WebSocket] Sala ${currentRoom} eliminada - no quedan clientes`);
        }
        console.log(`[WebSocket] Cliente desconectado de sala ${currentRoom}. Clientes restantes: ${rooms.get(currentRoom)?.size || 0}`);
      }
    });
  });

  return httpServer;
}