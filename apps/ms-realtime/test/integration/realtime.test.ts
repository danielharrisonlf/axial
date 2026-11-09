import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { Queue } from "bullmq";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { readConfig } from "../../src/config.js";
import { RealtimeServer } from "../../src/realtime.js";

const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl || new URL(redisUrl).pathname !== "/14")
  throw new Error("TEST_REDIS_URL must use isolated Redis DB 14");
const org = randomUUID(),
  otherOrg = randomUUID(),
  project = randomUUID(),
  forbidden = randomUUID();
const user = randomUUID();
let directory: string, api: Server, one: RealtimeServer, two: RealtimeServer, queue: Queue;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let allow = true;
const sockets: WebSocket[] = [];
const jobs: string[] = [];
function next(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for message"));
    }, 5000);
    const onMessage = (raw: { toString(): string }) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
    };
    socket.once("message", onMessage);
  });
}
function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once("close", resolve));
}
async function token(organizationId = org, lifetime = 60): Promise<string> {
  return new SignJWT({ organizationId, role: "VIEWER" })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject(user)
    .setIssuer("test-issuer")
    .setAudience("test-audience")
    .setIssuedAt()
    .setExpirationTime(`${lifetime}s`)
    .sign(privateKey);
}
async function connect(server: RealtimeServer, credential: string): Promise<WebSocket> {
  const socket = new WebSocket(server.address());
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const response = next(socket);
  socket.send(JSON.stringify({ type: "authenticate", token: credential }));
  expect(await response).toEqual({ type: "authenticated" });
  return socket;
}
async function subscribe(socket: WebSocket, id: string): Promise<void> {
  const response = next(socket);
  socket.send(JSON.stringify({ type: "subscribe", projectId: id }));
  expect(await response).toEqual({ type: "subscribed", projectId: id });
}
function event() {
  return {
    id: randomUUID(),
    type: "task.updated",
    version: 1,
    occurredAt: new Date().toISOString(),
    organizationId: org,
    projectId: project,
    aggregate: { type: "task", id: randomUUID(), version: 2 },
    actor: { id: user, source: "api" },
    correlationId: "test",
    data: { before: { secret: "private" }, after: {} },
  };
}
async function enqueue(value: ReturnType<typeof event>): Promise<void> {
  const jobId = randomUUID();
  jobs.push(jobId);
  await queue.add(value.type, value, { jobId });
}

describe("realtime integration with Redis", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(process.cwd(), ".realtime-test-"));
    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = pair.privateKey;
    const keyPath = join(directory, "public.pem");
    await writeFile(keyPath, await exportSPKI(pair.publicKey));
    api = createServer((req, res) => {
      res.writeHead(
        allow && req.url === `/api/v1/projects/${project}` && req.headers.authorization ? 200 : 404,
      );
      res.end("{}");
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const address = api.address();
    if (!address || typeof address === "string") throw new Error("API failed");
    const config = readConfig({
      REALTIME_PORT: "0",
      REALTIME_NAMESPACE: `test_${randomUUID()}`,
      REDIS_URL: redisUrl,
      JWT_ISSUER: "test-issuer",
      JWT_AUDIENCE: "test-audience",
      JWT_PUBLIC_KEY_PATH: keyPath,
      PROJECTS_API_URL: `http://127.0.0.1:${address.port}/api/v1`,
    });
    one = await RealtimeServer.start(config);
    two = await RealtimeServer.start(config);
    queue = new Queue("axial-realtime", { connection: { url: redisUrl } });
  });
  afterAll(async () => {
    for (const socket of sockets) socket.terminate();
    await one?.close();
    await two?.close();
    if (queue) {
      for (const id of jobs) {
        const job = await queue.getJob(id);
        await job?.remove();
      }
      await queue.close();
    }
    if (api) await new Promise<void>((resolve) => api.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("reports readiness and liveness, and becomes unavailable when the subscriber disconnects", async () => {
    const base = one.address().replace("ws://", "http://").replace("/ws", "");
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
    expect((await fetch(`${base}/health/ready`)).status).toBe(200);
    const subscriber = (one as unknown as { subscriber: import("ioredis").Redis }).subscriber;
    const disconnected = new Promise<void>((resolve) => subscriber.once("close", () => resolve()));
    subscriber.disconnect();
    await disconnected;
    expect((await fetch(`${base}/health/ready`)).status).toBe(503);
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
    await subscriber.connect();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Subscription did not recover")), 5000);
      const poll = async () => {
        if ((await fetch(`${base}/health/ready`)).status === 200) {
          clearTimeout(timeout);
          resolve();
        } else if (subscriber.status !== "end")
          setTimeout(() => {
            void poll();
          }, 50);
      };
      void poll();
    });
  });
  it("fans out invalidations across instances, isolates organizations and suppresses duplicates", async () => {
    const first = await connect(one, await token()),
      second = await connect(two, await token());
    const outsider = await connect(two, await token(otherOrg));
    await subscribe(first, project);
    await subscribe(second, project);
    await subscribe(outsider, project);
    const a = next(first),
      b = next(second);
    const received: string[] = [];
    outsider.on("message", (data) => received.push(data.toString()));
    const value = event();
    await enqueue(value);
    const [left, right] = await Promise.all([a, b]);
    expect(left).toEqual(right);
    expect(left).toMatchObject({ type: "invalidation", eventId: value.id, projectId: project });
    expect(JSON.stringify(left)).not.toContain("private");
    let duplicates = 0;
    first.on("message", () => {
      duplicates++;
    });
    await enqueue(value);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(duplicates).toBe(0);
    expect(received).toEqual([]);
  });
  it("rejects unauthorized project subscriptions", async () => {
    const socket = await connect(one, await token());
    const result = closed(socket);
    socket.send(JSON.stringify({ type: "subscribe", projectId: forbidden }));
    expect(await result).toBe(1008);
  });
  it("rechecks access on delivery and closes when access is revoked", async () => {
    const socket = await connect(one, await token());
    await subscribe(socket, project);
    const result = closed(socket);
    allow = false;
    await enqueue(event());
    expect(await result).toBe(1008);
    allow = true;
  });
  it("closes sockets at token expiry and rejects invalid JWT", async () => {
    const invalid = new WebSocket(one.address());
    sockets.push(invalid);
    await new Promise<void>((resolve) => invalid.once("open", resolve));
    const denied = closed(invalid);
    invalid.send(JSON.stringify({ type: "authenticate", token: "invalid" }));
    expect(await denied).toBe(1008);
    const expiring = await connect(one, await token(org, 2));
    expect(await closed(expiring)).toBe(1008);
  });
});
