import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { type SignalingMessage } from "@shared/schema";

const clients = new Map<string, Map<string, WebSocket>>();

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Create WebSocket server
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/ws',
    perMessageDeflate: false // Disable compression for WebRTC data
  });

  console.log("[WebSocket] Server initialized");

  wss.on('connection', (ws: WebSocket, req) => {
    console.log("[WebSocket] New connection from:", req.socket.remoteAddress);

    let roomId = '';
    let clientId = '';

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[WebSocket] Received message:", message);

        // Handle join room message
        if (message.type === 'join' && message.roomId) {
          roomId = message.roomId;
          clientId = Math.random().toString(36).substring(7);

          // Initialize room if needed
          if (!clients.has(roomId)) {
            clients.set(roomId, new Map());
          }

          // Add client to room
          const room = clients.get(roomId);
          if (room) {
            room.set(clientId, ws);
            console.log(`[WebSocket] Client ${clientId} joined room ${roomId}`);

            // Send joined confirmation
            ws.send(JSON.stringify({
              type: 'joined',
              clientId,
              clients: room.size
            }));
          }
          return;
        }

        // Handle WebRTC signaling messages
        if (roomId && clientId) {
          const room = clients.get(roomId);
          if (room) {
            // Broadcast to all other clients in the room
            room.forEach((client, id) => {
              if (id !== clientId && client.readyState === WebSocket.OPEN) {
                client.send(data.toString());
              }
            });
          }
        }

      } catch (error) {
        console.error("[WebSocket] Error processing message:", error);
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid message format'
        }));
      }
    });

    ws.on('error', (error) => {
      console.error("[WebSocket] Client error:", error);
    });

    ws.on('close', () => {
      if (roomId && clientId) {
        const room = clients.get(roomId);
        if (room) {
          room.delete(clientId);
          if (room.size === 0) {
            clients.delete(roomId);
          }
          console.log(`[WebSocket] Client ${clientId} left room ${roomId}`);
        }
      }
    });
  });

  return httpServer;
}