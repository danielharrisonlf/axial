import { createServer, type Server } from "node:http";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { WebSocket, WebSocketServer } from "ws";
import { type Config, createVerifier, type Identity } from "./config.js";
import { eventSchema, messageSchema } from "./protocol.js";

type Client = {
  socket: WebSocket;
  token: string;
  identity: Identity;
  projects: Set<string>;
  timer: NodeJS.Timeout;
};
export class RealtimeServer {
  private get channel(): string {
    return `${this.config.REALTIME_NAMESPACE}:realtime:invalidation:v1`;
  }
  private readonly server: Server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health/live") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
      return;
    }
    if (request.method === "GET" && request.url === "/health/ready") {
      void this.ready().then((ready) => {
        response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
        response.end(ready ? '{"status":"ok"}' : '{"status":"unavailable"}');
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  private subscribed = false;
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 20000 });
  private readonly clients = new Set<Client>();
  private readonly subscriber: Redis;
  private readonly publisher: Redis;
  private readonly worker: Worker;
  private readonly seen = new Map<string, number>();
  private constructor(
    private readonly config: Config,
    private readonly verify: Awaited<ReturnType<typeof createVerifier>>,
  ) {
    this.subscriber = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, autoResubscribe: false });
    this.publisher = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.subscriber.on("error", () => {
      this.subscribed = false;
      this.disconnectAll();
    });
    this.subscriber.on("ready", () => {
      void this.subscriber
        .subscribe(this.channel)
        .then(() => {
          this.subscribed = true;
        })
        .catch(() => {
          this.subscribed = false;
        });
    });
    this.publisher.on("error", () => {
      /* BullMQ retries failed publication. */
    });
    this.subscriber.on("close", () => {
      this.subscribed = false;
      this.disconnectAll();
    });
    this.subscriber.on("message", (_channel, value) => {
      void this.deliver(value);
    });
    this.worker = new Worker(
      "axial-realtime",
      async (job) => {
        const event = eventSchema.parse(job.data);
        await this.publisher.publish(this.channel, JSON.stringify(event));
      },
      { connection: { url: config.REDIS_URL } },
    );
    this.worker.on("error", () => {
      /* Worker retries Redis connectivity. */
    });
    this.server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/ws") {
        socket.destroy();
        return;
      }
      this.sockets.handleUpgrade(request, socket, head, (ws) => this.sockets.emit("connection", ws));
    });
    this.sockets.on("connection", (socket: WebSocket) => this.accept(socket));
  }
  static async start(config: Config): Promise<RealtimeServer> {
    const instance = new RealtimeServer(config, await createVerifier(config));
    try {
      await instance.subscriber.subscribe(instance.channel);
      instance.subscribed = true;
      await new Promise<void>((resolve, reject) => {
        instance.server.once("error", reject);
        instance.server.listen(config.REALTIME_PORT, () => {
          instance.server.off("error", reject);
          resolve();
        });
      });
      return instance;
    } catch (error) {
      await instance.close();
      throw error;
    }
  }
  address(): string {
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Server not listening");
    return `ws://127.0.0.1:${address.port}/ws`;
  }
  private async ready(): Promise<boolean> {
    if (
      !this.subscribed ||
      this.subscriber.status !== "ready" ||
      this.publisher.status !== "ready" ||
      !this.worker.isRunning()
    )
      return false;
    let timer: NodeJS.Timeout | undefined;
    try {
      const probe = async () => {
        const workerClient = await this.worker.client;
        return workerClient.status === "ready" && (await this.publisher.ping()) === "PONG";
      };
      const available = await Promise.race([
        probe(),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 1500);
        }),
      ]);
      return (
        available &&
        this.subscribed &&
        this.subscriber.status === "ready" &&
        this.publisher.status === "ready" &&
        this.worker.isRunning()
      );
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private accept(socket: WebSocket): void {
    let client: Client | undefined;
    let busy = false;
    const deadline = setTimeout(() => socket.close(1008, "Authentication required"), 5000);
    socket.on("error", () => socket.terminate());
    socket.on("close", () => {
      clearTimeout(deadline);
      if (client) {
        clearTimeout(client.timer);
        this.clients.delete(client);
      }
    });
    socket.on("message", (raw) => {
      if (busy) {
        socket.close(1008, "Concurrent request");
        return;
      }
      busy = true;
      void (async () => {
        const message = messageSchema.parse(JSON.parse(raw.toString()));
        if (!client) {
          if (message.type !== "authenticate") throw new Error("Authentication required");
          const identity = await this.verify(message.token);
          if (socket.readyState !== WebSocket.OPEN || identity.exp * 1000 <= Date.now())
            throw new Error("Expired");
          const timer = setTimeout(
            () => socket.close(1008, "Token expired"),
            Math.min(identity.exp * 1000 - Date.now(), 2147483647),
          );
          client = { socket, token: message.token, identity, projects: new Set(), timer };
          this.clients.add(client);
          clearTimeout(deadline);
          socket.send(JSON.stringify({ type: "authenticated" }));
          return;
        }
        if (message.type === "authenticate") throw new Error("Already authenticated");
        if (message.type === "unsubscribe") {
          client.projects.delete(message.projectId);
          return;
        }
        if (client.projects.size >= 100 || !(await this.authorized(client, message.projectId)))
          throw new Error("Access denied");
        if (socket.readyState === WebSocket.OPEN && client.identity.exp * 1000 > Date.now()) {
          client.projects.add(message.projectId);
          socket.send(JSON.stringify({ type: "subscribed", projectId: message.projectId }));
        }
      })()
        .catch(() => socket.close(1008, "Unauthorized or invalid request"))
        .finally(() => {
          busy = false;
        });
    });
  }
  private async authorized(client: Client, projectId: string): Promise<boolean> {
    if (client.identity.exp * 1000 <= Date.now()) return false;
    try {
      const base = this.config.PROJECTS_API_URL.replace(/\/$/, "");
      const response = await fetch(`${base}/projects/${projectId}`, {
        headers: { authorization: `Bearer ${client.token}` },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      return response.ok && client.identity.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }
  private async deliver(value: string): Promise<void> {
    let event: ReturnType<typeof eventSchema.parse>;
    try {
      event = eventSchema.parse(JSON.parse(value));
    } catch {
      return;
    }
    const now = Date.now();
    for (const [id, expiry] of this.seen) if (expiry <= now) this.seen.delete(id);
    if (this.seen.has(event.id)) return;
    if (this.seen.size >= 10000) {
      const oldest = this.seen.keys().next().value;
      if (oldest) this.seen.delete(oldest);
    }
    this.seen.set(event.id, now + 60000);
    const payload = JSON.stringify({
      type: "invalidation",
      eventId: event.id,
      eventType: event.type,
      occurredAt: event.occurredAt,
      projectId: event.projectId,
      aggregate: event.aggregate,
    });
    await Promise.all(
      [...this.clients].map(async (client) => {
        if (client.identity.organizationId !== event.organizationId || !client.projects.has(event.projectId))
          return;
        if (!(await this.authorized(client, event.projectId))) {
          client.socket.close(1008, "Access unavailable");
          return;
        }
        if (
          client.socket.readyState === WebSocket.OPEN &&
          client.projects.has(event.projectId) &&
          client.identity.exp * 1000 > Date.now()
        )
          client.socket.send(payload);
      }),
    );
  }
  private disconnectAll(): void {
    for (const client of this.clients) client.socket.close(1012, "Resync required");
  }
  async close(): Promise<void> {
    for (const socket of this.sockets.clients) socket.terminate();
    await this.worker.close();
    this.subscriber.disconnect();
    this.publisher.disconnect();
    await new Promise<void>((resolve) => this.sockets.close(() => resolve()));
    if (this.server.listening) await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
