import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { config } from "./config.js";
import { BLESSING } from "./version.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { requireMcpAuth, mcpAuthEnabled } from "./auth/mcp.js";
import { createApiRouter } from "./routes/index.js";
import "./db/index.js"; // initialise schema on boot

const MCP_PATH = "/mcp";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "../public");

const app = express();
app.use(express.json({ limit: `${config.upload.maxFileSizeMb}mb` }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION });
});

// ---- Management REST API ----
app.use("/api", createApiRouter());

// ---- MCP endpoint (Streamable HTTP + legacy SSE), Bearer-guarded ----
app.use(MCP_PATH, requireMcpAuth);

const SSE_KEEPALIVE_MS = 15_000;
const sseSessions = new Map<string, SSEServerTransport>();

app.get(MCP_PATH, async (_req: Request, res: Response) => {
  const server = createMcpServer();
  const transport = new SSEServerTransport(MCP_PATH, res);
  const sessionId = transport.sessionId;
  sseSessions.set(sessionId, transport);

  const keepalive = setInterval(() => {
    if (!res.writableEnded) res.write(": keepalive\n\n");
  }, SSE_KEEPALIVE_MS);
  keepalive.unref();

  const cleanup = () => {
    clearInterval(keepalive);
    if (sseSessions.get(sessionId) === transport) sseSessions.delete(sessionId);
    void transport.close();
    void server.close();
  };
  res.on("close", cleanup);

  try {
    await server.connect(transport);
  } catch (err) {
    console.error("[mcp] sse connect failed:", err);
    cleanup();
    if (!res.headersSent) res.status(500).end();
  }
});

app.post(MCP_PATH, async (req: Request, res: Response) => {
  const sessionId =
    typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;

  if (sessionId) {
    const transport = sseSessions.get(sessionId);
    if (!transport) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: "Unknown sessionId" },
        id: null,
      });
      return;
    }
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      console.error("[mcp] sse post failed:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
    return;
  }

  // Streamable HTTP (stateless): a fresh server+transport per request.
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// ---- Static frontend (SPA) ----
if (existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api") || req.path.startsWith(MCP_PATH)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendFile(resolve(PUBLIC_DIR, "index.html"));
  });
}

const httpServer = app.listen(config.port, config.host, () => {
  console.log(BLESSING);
  console.log(
    `[${SERVER_NAME}] v${SERVER_VERSION} listening on http://${config.host}:${config.port}` +
      ` | mcp=${MCP_PATH} (streamable-http+sse) | mcp-auth=${mcpAuthEnabled ? "on" : "OFF"}` +
      ` | static=${existsSync(PUBLIC_DIR) ? "on" : "off"}`,
  );
  if (!mcpAuthEnabled) {
    console.warn(`[${SERVER_NAME}] WARNING: MCP_API_KEY is empty — /mcp is open.`);
  }
});

function shutdown(sig: string): void {
  console.log(`[${SERVER_NAME}] ${sig} received, shutting down.`);
  httpServer.close(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
