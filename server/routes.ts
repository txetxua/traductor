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

  // Nuevo endpoint para traducciones
  app.post("/api/translate", async (req, res) => {
    const result = translateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: "Invalid translation request" });
    }

    try {
      // Por ahora, simularemos la traducción
      // Aquí deberías integrar un servicio real de traducción
      const translated = `[${result.data.to.toUpperCase()}] ${result.data.text}`;
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

        if (message.type === "join") {
          const roomId = message.roomId;
          currentRoom = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
          }
          rooms.get(roomId)!.add(ws);

          console.log(`Client joined room: ${roomId}`);
        } 
        else if (message.type === "translation" || message.type === "offer" || 
                 message.type === "answer" || message.type === "ice-candidate") {
          // Broadcast to all clients in room except sender
          if (currentRoom && rooms.has(currentRoom)) {
            rooms.get(currentRoom)!.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(data.toString());
              }
            });
          }
        }
      } catch (err) {
        console.error("WebSocket message error:", err);
      }
    });

    ws.on("close", () => {
      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
        if (rooms.get(currentRoom)!.size === 0) {
          rooms.delete(currentRoom);
        }
        console.log(`Client left room: ${currentRoom}`);
      }
    });
  });

  return httpServer;
}