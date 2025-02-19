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

  io.on('connection', (socket) => {
    console.log("[SocketIO] New connection:", socket.id);
    let currentRoom: string;

    socket.on('join', ({ roomId }) => {
      try {
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

      } catch (error) {
        console.error("[SocketIO] Join error:", error);
        socket.emit('error', {
          message: 'Error al unirse a la sala'
        });
      }
    });

    // Handle WebRTC signaling
    socket.on('signal', (message) => {
      try {
        if (!currentRoom) {
          throw new Error('No room joined');
        }

        console.log("[SocketIO] Broadcasting signal:", message.type);
        socket.to(currentRoom).emit('signal', message);

      } catch (error) {
        console.error("[SocketIO] Signal error:", error);
        socket.emit('error', {
          message: 'Error al procesar señal'
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