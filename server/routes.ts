import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { 
  type SignalingMessage,
  type TranslationMessage 
} from "@shared/schema";
import { translateText } from "./translation-service";

const translateSchema = z.object({
  text: z.string(),
  from: z.enum(["es", "it"]),
  to: z.enum(["es", "it"]),
  roomId: z.string()
});

export async function registerRoutes(app: Express): Promise<Server> {
  const sseClients = new Map<string, Set<{
    res: any;
    language: string;
    keepAliveInterval?: NodeJS.Timeout;
  }>>();

  const httpServer = createServer(app);

  // Store pending signals for each room
  const pendingSignals = new Map<string, SignalingMessage[]>();

  app.get("/api/signal/:roomId", (req, res) => {
    const roomId = req.params.roomId;
    const signals = pendingSignals.get(roomId) || [];
    pendingSignals.set(roomId, []); // Clear signals after sending
    res.json(signals);
  });

  app.post("/api/signal/:roomId", (req, res) => {
    const roomId = req.params.roomId;
    const signal = req.body as SignalingMessage;

    if (!pendingSignals.has(roomId)) {
      pendingSignals.set(roomId, []);
    }

    pendingSignals.get(roomId)!.push(signal);
    res.status(200).json({ status: "ok" });
  });

  app.get("/api/translations/stream/:roomId", (req, res) => {
    const roomId = req.params.roomId;
    const language = req.query.language as string;

    console.log("[Translations] New SSE connection request:", {
      roomId,
      language,
      headers: req.headers
    });

    if (!roomId || !language || !["es", "it"].includes(language)) {
      console.error("[Translations] Invalid request parameters:", { roomId, language });
      res.status(400).json({ error: "Invalid room ID or language" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    const keepAliveInterval = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 30000);

    if (!sseClients.has(roomId)) {
      sseClients.set(roomId, new Set());
    }

    const client = { res, language, keepAliveInterval };
    sseClients.get(roomId)!.add(client);

    console.log("[Translations] Client connected:", {
      roomId,
      language,
      totalClients: sseClients.get(roomId)?.size
    });

    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    req.on("close", () => {
      console.log("[Translations] Client disconnected:", { roomId, language });
      clearInterval(keepAliveInterval);
      const roomClients = sseClients.get(roomId);
      if (roomClients) {
        roomClients.delete(client);
        if (roomClients.size === 0) {
          sseClients.delete(roomId);
        }
        console.log("[Translations] Remaining clients in room:", roomClients.size);
      }
    });
  });

  app.post("/api/translate", async (req, res) => {
    try {
      const result = translateSchema.safeParse(req.body);
      if (!result.success) {
        console.error("[Translate] Invalid request:", result.error);
        return res.status(400).json({ error: "Invalid translation request" });
      }

      const { text, from, to, roomId } = result.data;
      console.log(`[Translate] Processing translation from ${from} to ${to}:`, text);

      const translated = await translateText(text, from, to);
      console.log(`[Translate] Text translated: "${text}" -> "${translated}"`);

      const roomClients = sseClients.get(roomId);
      if (roomClients) {
        console.log("[Translate] Broadcasting to room clients:", roomClients.size);

        const message: TranslationMessage = {
          type: "translation",
          text,
          translated,
          from,
          to
        };

        roomClients.forEach(client => {
          try {
            client.res.write(`data: ${JSON.stringify(message)}\n\n`);
          } catch (error) {
            console.error("[Translate] Error sending to client:", error);
          }
        });
      }

      res.json({ translated });
    } catch (error) {
      console.error("[Translate] Error:", error);
      res.status(500).json({ error: "Translation failed" });
    }
  });

  return httpServer;
}