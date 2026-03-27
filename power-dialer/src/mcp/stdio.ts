#!/usr/bin/env npx tsx
// ============================================================
// TCG Power Dialer — MCP Stdio Transport
// ============================================================
// Run this directly for Claude Desktop local connections.
// Add to claude_desktop_config.json as a stdio server.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TCG Power Dialer MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
