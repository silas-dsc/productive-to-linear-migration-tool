import { type Server } from "node:http";

import express, {
  type Express,
  type Request,
  Response,
  NextFunction,
} from "express";

import { registerRoutes } from "./routes";
import { execSync } from 'node:child_process';

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export const app = express();

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

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

export default async function runApp(
  setup: (app: Express, server: Server) => Promise<void>,
) {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly run the final setup after setting up all the other routes so
  // the catch-all route doesn't interfere with the other routes
  await setup(app, server);

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const basePort = parseInt(process.env.PORT || '5000', 10);

  const MAX_ATTEMPTS = 5;

  const autoKill = String(process.env.AUTO_KILL_PORT || '').toLowerCase() === '1' || String(process.env.AUTO_KILL_PORT || '').toLowerCase() === 'true';

  function findPidsListeningOn(portNum: number): number[] {
    try {
      const out = execSync(`lsof -ti tcp:${portNum}`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      return out.split(/\s+/).filter(Boolean).map(s => parseInt(s, 10)).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function tryListen(port: number, attemptsLeft: number, triedKill = false) {
    // Remove previous error listeners to avoid memory leaks for repeated tries
    server.removeAllListeners('error');

    server.once('error', (err: any) => {
      if (err && (err as any).code === 'EADDRINUSE') {
        log(`port ${port} already in use`, 'server');

        if (attemptsLeft > 0) {
          const nextPort = port + 1;
          log(`trying next port ${nextPort} (${attemptsLeft} attempts left)`, 'server');
          setTimeout(() => tryListen(nextPort, attemptsLeft - 1, triedKill), 200);
          return;
        }

        const pids = findPidsListeningOn(port);
        if (pids.length > 0) {
          log(`found process(es) listening on ${port}: ${pids.join(', ')}`, 'server');

          if (autoKill && !triedKill) {
            try {
              for (const pid of pids) {
                log(`killing PID ${pid} (AUTO_KILL_PORT enabled)`, 'server');
                execSync(`kill -9 ${pid}`);
              }
              // After killing, give the OS a moment to free the socket
              setTimeout(() => tryListen(port, 0, true), 300);
              return;
            } catch (killErr: any) {
              log(`failed to kill process: ${killErr?.message || killErr}`, 'server');
            }
          }

          log(`To free the port run: lsof -ti tcp:${port} | xargs kill -9`, 'server');
        } else {
          log(`port ${port} appears in use but no PID found via lsof`, 'server');
        }

        log(`failed to bind after trying ports starting at ${basePort}`, 'server');
        process.exit(1);
      } else {
        log(`server error: ${(err && err.message) || err}`, 'server');
        throw err;
      }
    });

    server.listen({ port, host: '0.0.0.0', reusePort: true }, () => {
      log(`serving on port ${port}`);
    });
  }

  tryListen(basePort, MAX_ATTEMPTS - 1);
}
