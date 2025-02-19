import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { type SignalingMessage } from "@shared/schema";

const rooms = new Map<string, Set<string>>();

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Create Socket.IO server
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    path: '/socket.io'
  });

  console.log("[SocketIO] Server initialized");

  // Setup SSE translation endpoint
  app.get('/api/translations/stream/:roomId', (req, res) => {
    try {
      const roomId = req.params.roomId;
      const language = req.query.language as string;

      if (!roomId || !language) {
        res.status(400).json({ error: 'Room ID and language are required' });
        return;
      }

      // Set SSE headers before any write operation
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Important: Send initial newlines to establish SSE connection
      res.write('\n');

      // Send initial connection confirmation
      const initialEvent = `data: ${JSON.stringify({ type: "connected" })}\n\n`;
      res.write(initialEvent);

      console.log(`[Translations] Client connected to room ${roomId} with language ${language}`);

      // Keep connection alive with comments
      const keepAlive = setInterval(() => {
        if (!res.writableEnded) {
          res.write(': keepalive\n\n');
        }
      }, 15000);

      // Clean up on close
      req.on('close', () => {
        console.log(`[Translations] Client disconnected from room ${roomId}`);
        clearInterval(keepAlive);
      });

    } catch (error) {
      console.error('[Translations] Error setting up SSE:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  io.on('connection', (socket) => {
    console.log("[SocketIO] New connection:", socket.id);
    let currentRoom: string | null = null;

    socket.on('join', ({ roomId }) => {
      try {
        if (!roomId) {
          throw new Error('Room ID is required');
        }

        // Leave previous room if any
        if (currentRoom) {
          socket.leave(currentRoom);
          const prevRoom = rooms.get(currentRoom);
          if (prevRoom) {
            prevRoom.delete(socket.id);
            if (prevRoom.size === 0) {
              rooms.delete(currentRoom);
            }
          }
        }

        currentRoom = roomId;
        socket.join(roomId);

        // Initialize room if needed
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Set());
        }

        // Add client to room
        const room = rooms.get(roomId)!;
        room.add(socket.id);

        console.log(`[SocketIO] Client ${socket.id} joined room ${roomId}`);

        // Notify client
        socket.emit('joined', {
          clientId: socket.id,
          clients: room.size
        });

      } catch (error: any) {
        console.error("[SocketIO] Join error:", error);
        socket.emit('error', {
          message: error.message || 'Error al unirse a la sala'
        });
      }
    });

    // Handle WebRTC signaling
    socket.on('signal', (message: SignalingMessage) => {
      try {
        if (!currentRoom) {
          console.log("[SocketIO] Signal received before joining room");
          socket.emit('error', {
            message: 'Debe unirse a una sala primero'
          });
          return;
        }

        const room = rooms.get(currentRoom);
        if (!room) {
          throw new Error('Room not found');
        }

        console.log(`[SocketIO] Broadcasting ${message.type} to room ${currentRoom}`);
        socket.to(currentRoom).emit('signal', message);

      } catch (error: any) {
        console.error("[SocketIO] Signal error:", error);
        socket.emit('error', {
          message: error.message || 'Error al procesar señal'
        });
      }
    });

    socket.on('disconnect', () => {
      if (currentRoom) {
        const room = rooms.get(currentRoom);
        if (room) {
          room.delete(socket.id);
          if (room.size === 0) {
            rooms.delete(currentRoom);
          }
          console.log(`[SocketIO] Client ${socket.id} left room ${currentRoom}`);
        }
      }
    });

    socket.on('error', (error) => {
      console.error("[SocketIO] Socket error:", error);
    });
  });

  return httpServer;
}