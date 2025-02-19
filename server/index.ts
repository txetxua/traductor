import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();

// Enhanced CORS middleware with specific WebRTC and WebSocket support
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';

  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');

  // Special headers for WebSocket and WebRTC
  if (req.headers.upgrade === 'websocket') {
    res.header('Connection', 'Upgrade');
    res.header('Upgrade', 'websocket');
  }

  // Handle WebRTC specific headers
  if (req.headers['sec-webrtc-priority']) {
    res.header('Access-Control-Allow-Headers', 
      res.getHeader('Access-Control-Allow-Headers') + ', sec-webrtc-priority');
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Basic middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Enhanced logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  if (path.startsWith("/ws") || req.headers.upgrade) {
    log(`WebSocket/WebRTC upgrade request: ${req.method} ${path}`);
    log(`Headers: ${JSON.stringify(req.headers)}`);
  }

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    const server = await registerRoutes(app);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      console.error("[Server] Error:", err);
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
    });

    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    const PORT = 5000;
    server.listen(PORT, "0.0.0.0", () => {
      log(`Server running on port ${PORT}`);
      log(`WebSocket/WebRTC server available at wss://0.0.0.0:${PORT}/ws`);
    });
  } catch (error) {
    console.error("[Server] Fatal error:", error);
    process.exit(1);
  }
})();