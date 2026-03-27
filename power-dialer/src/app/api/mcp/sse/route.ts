// GET /api/mcp/sse — SSE endpoint for remote Claude connections
// POST /api/mcp/sse — Message endpoint for Claude to send tool calls
//
// This is a lightweight JSON-RPC bridge over SSE that wraps the MCP server.
// Claude connects via GET (SSE stream), sends tool calls via POST.

import { NextRequest, NextResponse } from "next/server";
import { createMcpServer } from "@/mcp/server";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Active sessions: sessionId → { transport, server }
const activeSessions = new Map<
  string,
  {
    clientTransport: InstanceType<typeof InMemoryTransport>;
    serverTransport: InstanceType<typeof InMemoryTransport>;
    pendingResponses: ((msg: string) => void)[];
  }
>();

function checkAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  const queryKey = req.nextUrl.searchParams.get("key");
  const mcpKey = process.env.MCP_API_KEY;
  if (!mcpKey) return true; // Dev mode — no auth required
  if (authHeader) return authHeader === `Bearer ${mcpKey}`;
  if (queryKey) return queryKey === mcpKey;
  return false;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sessionId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Create linked in-memory transports
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Connect the MCP server to the server-side transport
  const server = createMcpServer();
  server.connect(serverTransport).catch((err: Error) => {
    console.error("MCP server connection error:", err);
  });

  const pendingResponses: ((msg: string) => void)[] = [];

  activeSessions.set(sessionId, {
    clientTransport,
    serverTransport,
    pendingResponses,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send the session ID as the first event so the client knows where to POST
      controller.enqueue(
        encoder.encode(`event: endpoint\ndata: /api/mcp/sse?sessionId=${sessionId}\n\n`)
      );

      // Listen for messages from the server transport going to the client
      clientTransport.onmessage = (msg: unknown) => {
        const data = JSON.stringify(msg);
        controller.enqueue(encoder.encode(`event: message\ndata: ${data}\n\n`));
      };

      clientTransport.onclose = () => {
        controller.close();
        activeSessions.delete(sessionId);
      };
    },
    cancel() {
      clientTransport.close();
      serverTransport.close();
      activeSessions.delete(sessionId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
  }

  try {
    const message = await req.json();

    // Send the message through the client transport to the server
    await session.clientTransport.send(message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("MCP POST error:", err);
    return NextResponse.json({ error: "Failed to process message" }, { status: 500 });
  }
}
