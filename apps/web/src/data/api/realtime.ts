import { z } from "zod";

/**
 * Invalidations from ms-realtime (plain WebSocket at `/ws` through the gateway). The protocol
 * handles one message at a time: `authenticate` first, then one `subscribe` per project, each
 * waiting for its answer. The server closes the socket when the token expires; the client then
 * reconnects with the current token. Invalidations carry no data: the Workspace reads the
 * affected project again.
 */

const serverMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("authenticated") }),
  z.object({ type: z.literal("subscribed"), projectId: z.string() }),
  z.object({ type: z.literal("invalidation"), projectId: z.string(), eventType: z.string() }),
]);

/** Most projects one socket follows (ms-realtime refuses more). */
export const MAX_SUBSCRIPTIONS = 100;

export function realtimeUrl(apiBase: string, location: Pick<Location, "protocol" | "host">): string {
  if (apiBase) return `${apiBase.replace(/^http/, "ws")}/ws`;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

export interface RealtimeOptions {
  url: string;
  token: () => string | null;
  projectIds: () => string[];
  onInvalidation: (projectId: string, eventType: string) => void;
  /** After a reconnection: changes may have been missed while the socket was down. */
  onResync?: () => void;
  createSocket?: (url: string) => WebSocket;
}

export function startRealtime(options: RealtimeOptions): { stop(): void; resubscribe(): void } {
  let socket: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let connectedBefore = false;
  let subscribed = new Set<string>();
  let queue: string[] = [];
  let waiting = false;

  const next = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN || waiting) return;
    const projectId = queue.shift();
    if (!projectId) return;
    waiting = true;
    socket.send(JSON.stringify({ type: "subscribe", projectId }));
  };
  const plan = () => {
    const wanted = options.projectIds().slice(0, MAX_SUBSCRIPTIONS);
    queue = wanted.filter((id) => !subscribed.has(id) && !queue.includes(id)).concat(queue);
    next();
  };
  const connect = () => {
    const token = options.token();
    if (stopped || !token) return;
    const ws = (options.createSocket ?? ((url) => new WebSocket(url)))(options.url);
    socket = ws;
    subscribed = new Set();
    queue = [];
    waiting = false;
    ws.onopen = () => ws.send(JSON.stringify({ type: "authenticate", token }));
    ws.onmessage = (event) => {
      let message: z.infer<typeof serverMessage>;
      try {
        message = serverMessage.parse(JSON.parse(String(event.data)));
      } catch {
        return; // unknown message kinds are ignored; the protocol may grow
      }
      if (message.type === "authenticated") {
        attempt = 0;
        if (connectedBefore) options.onResync?.();
        connectedBefore = true;
        plan();
      } else if (message.type === "subscribed") {
        subscribed.add(message.projectId);
        waiting = false;
        next();
      } else options.onInvalidation(message.projectId, message.eventType);
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (stopped) return;
      // token expiry closes the socket by design: reconnect with the refreshed token
      const delay = Math.min(30_000, 1_000 * 2 ** attempt);
      attempt++;
      retry = setTimeout(connect, delay);
    };
  };
  connect();
  return {
    stop() {
      stopped = true;
      clearTimeout(retry);
      socket?.close(1000, "bye");
      socket = null;
    },
    resubscribe: plan,
  };
}
