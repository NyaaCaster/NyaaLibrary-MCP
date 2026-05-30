import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerKnowledgeBaseTools } from "./tools/knowledgeBase.js";
import { APP_VERSION } from "./version.js";

export const SERVER_NAME = "nyaalibrary-mcp";
export const SERVER_VERSION = APP_VERSION;

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { logging: {} } },
  );

  registerKnowledgeBaseTools(server);

  return server;
}
