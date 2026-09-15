import type { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { config } from "./config.js";
import { registerTools } from "./tools.js";

function buildServer(): McpServer {
  const server = new McpServer({
    name: "tww-seo-agent",
    version: "0.1.0",
  });
  registerTools(server);
  return server;
}

function requireBearerToken(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || "";
  const expected = `Bearer ${config.server.bearerToken}`;
  if (auth !== expected) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
    return;
  }
  next();
}

const app = createMcpExpressApp({
  host: "0.0.0.0",
  allowedHosts: [config.server.publicHost, "localhost", "127.0.0.1"],
});

// Unauthenticated health check for Docker/Caddy — no site or credential info.
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/mcp", requireBearerToken, async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: one server+transport per request
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless server: GET/DELETE on /mcp (session management) are not supported.
app.get("/mcp", requireBearerToken, (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});
app.delete("/mcp", requireBearerToken, (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.listen(config.server.port, () => {
  console.log(
    `tww-seo-agent MCP server listening on port ${config.server.port} (public host: ${config.server.publicHost})`
  );
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
