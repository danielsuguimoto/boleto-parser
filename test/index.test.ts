import { describe, expect, it } from "vitest";
import worker from "../src/index.js";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const mcpPost = (body: unknown) =>
  worker.fetch(
    new Request("https://test.local/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    }),
    { MCP_AUTH_TOKEN: "test-token" },
    ctx,
  );

const lastMessage = async (res: Response) => {
  const text = await res.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(dataLine ? dataLine.slice(5) : text);
};

describe("GET /", () => {
  it("returns metadata without auth", async () => {
    const res = await worker.fetch(new Request("https://test.local/"), {}, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: string[] };
    expect(body.tools).toEqual(["parse_boleto", "health"]);
  });
});

describe("health tool", () => {
  it("answers tools/call with no arguments", async () => {
    const res = await mcpPost({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "health", arguments: {} } });
    expect(res.status).toBe(200);
    const msg = await lastMessage(res);
    expect(msg.result.isError).toBeUndefined();
    expect(msg.result.content[0].text).toBe('{"status":"ok"}');
    expect(msg.result.structuredContent).toEqual({ status: "ok" });
  });

  it("parse_boleto tools/list description includes a valid example", async () => {
    const res = await mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const msg = await lastMessage(res);
    const parse = msg.result.tools.find((t: { name: string }) => t.name === "parse_boleto");
    expect(parse.description).toMatch(/44.*47.*48/);
    expect(parse.description).toMatch(/\d{47}/);
  });
});
