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