import { ApiError, type TokenSource } from "./http";

/**
 * Test console call to the real MCP server (`POST /mcp` on the gateway, Streamable HTTP,
 * stateless JSON-RPC `tools/call`) with the person's access token. Workspace tokens carry the
 * `axial-projects` audience and no `scope`, which apps/mcp-server accepts with full scopes
 * (scopes.ts: first-party tokens); ms-projects still authorizes every call with the same role.
 */

let rpcId = 0;

/** Streamable HTTP answers either a JSON body or an SSE stream; returns the last JSON-RPC message. */
export function parseRpcBody(text: string, contentType: string): unknown {
  if (contentType.includes("text/event-stream")) {
    const line = text
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("data:"))
      .at(-1);
    if (!line) throw new Error("Resposta do MCP sem mensagem");
    return JSON.parse(line.slice(5).trim());
  }
  return text ? JSON.parse(text) : null;
}

export async function callMcpTool(
  options: { baseUrl: string; tokens: TokenSource; fetch?: typeof fetch },
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const doFetch = options.fetch ?? ((input: string, init: RequestInit) => globalThis.fetch(input, init));
  const send = async (token: string | null) => {
    try {
      return await doFetch(`${options.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++rpcId,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
    } catch {
      throw new ApiError(0, "Serviço indisponível");
    }
  };
  let response = await send(options.tokens.token());
  if (response.status === 401) {
    const fresh = await options.tokens.refresh();
    if (!fresh) {
      options.tokens.expired();
      throw new ApiError(401, "Sessão expirada");
    }
    response = await send(fresh);
  }
  const text = await response.text();
  if (!response.ok) throw new ApiError(response.status, text || response.statusText);
  return parseRpcBody(text, response.headers.get("content-type") ?? "");
}
