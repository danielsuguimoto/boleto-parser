import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { parseBoleto } from "./boleto.js";

interface Env {
  MCP_AUTH_TOKEN?: string;
}

function createServer() {
  const server = new McpServer({ name: "boleto-parser", version: "0.1.0" });

  server.registerTool(
    "parse_boleto",
    {
      description:
        "Decodes the digits of a Brazilian bank bill (boleto) barcode or digitable line (linha digitável). " +
        "Accepts 44 digits (barcode), 47 digits (bank slip digitable line) or 48 digits (collection/utility bill digitable line). " +
        "Returns the encoded fields: bank, currency, amount, expiration date, check digits, free field — or, for collection bills, " +
        "product, segment, value type, company id and free field. " +
        "Example of a valid bank slip digitable line: 23793381286000782713695000063305975520000370000. "+
        "Any other digit count is rejected — do not pass IDs, references, or other numeric identifiers.",
      inputSchema: z.object({
        digits: z
          .string()
          .describe("Barcode or digitable line digits. Formatting characters (spaces, dots, dashes, etc.) are stripped before parsing. Must contain exactly 44, 47, or 48 digits."),
      }),
    },
    async ({ digits }) => {
      try {
        const result = parseBoleto(digits);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "health",
    {
      description:
        "Liveness check. Returns {\"status\":\"ok\"}. Takes no arguments and never parses a boleto — " +
        "use it to verify the server is reachable instead of calling parse_boleto with a test value.",
    },
    async () => {
      const result = { status: "ok" as const };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  return server;
}

const mcpHandler = createMcpHandler(createServer, { route: "/mcp" });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          name: "boleto-parser",
          description: "MCP server that decodes Brazilian boleto barcode digits",
          endpoint: "/mcp",
          tools: ["parse_boleto", "health"],
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    const expectedToken = env.MCP_AUTH_TOKEN;
    const authorization = request.headers.get("authorization");
    if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    return mcpHandler(request, env, ctx);
  },
};
