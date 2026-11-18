import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { INestApplication } from "@nestjs/common";
import { McpHttpService } from "@nestjs/mcp";
import { connectMcpClient } from "@nestjs/mcp/testing";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";

export const ISSUER = "http://localhost:3000/identity";
export const AUDIENCE = "axial-projects";
/** MCP_RESOURCE of the harness: OAuth tokens (with a `scope` claim) must name it as an audience. */
export const RESOURCE = "http://localhost/mcp";
export const READ = "projects:read";
export const WRITE = "projects:write";
export const ORG = "0190f0f0-0000-7000-8000-000000000001";
export const PROJECT = "0190f0f0-0000-7000-8000-000000000002";
export const USER = "0190f0f0-0000-7000-8000-000000000003";
export const OTHER_PROJECT = "0190f0f0-0000-7000-8000-0000000000ff";

export type Service = "projects" | "audit" | "notifications" | "identity";

export interface SeenRequest {
  service: Service;
  method: string;
  path: string;
  query: URLSearchParams;
  authorization: string | null;
  body: unknown;
}

export interface StubAnswer {
  status?: number;
  body?: unknown;
}

type Handler = (request: SeenRequest) => StubAnswer | undefined;

/**
 * Simulated Kairos services on one port, one path prefix each (`/projects/api/v1/...`). Routes are matched by
 * `METHOD service path` (path without the `/api/v1` prefix, query excluded); unknown routes answer 404.
 */
export class UpstreamStub {
  readonly seen: SeenRequest[] = [];
  private readonly routes = new Map<string, Handler>();
  private server: Server | undefined;
  port = 0;

  on(method: string, service: Service, path: string, answer: StubAnswer | Handler): this {
    this.routes.set(`${method} ${service} ${path}`, typeof answer === "function" ? answer : () => answer);
    return this;
  }

  reset(): void {
    this.seen.length = 0;
    this.routes.clear();
  }

  requests(method: string, service: Service, path?: string): SeenRequest[] {
    return this.seen.filter(
      (request) =>
        request.method === method &&
        request.service === service &&
        (path === undefined || request.path === path),
    );
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let text = "";
    for await (const chunk of request) text += chunk;
    const url = new URL(request.url ?? "/", "http://stub");
    const [, service, ...rest] = url.pathname.split("/");
    const path = `/${rest.join("/")}`.replace(/^\/api\/v1/, "");
    if (path === "/health/ready") {
      response.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
      return;
    }
    const seen: SeenRequest = {
      service: service as Service,
      method: request.method ?? "GET",
      path,
      query: url.searchParams,
      authorization: request.headers.authorization ?? null,
      body: text ? JSON.parse(text) : null,
    };
    this.seen.push(seen);
    const answer = this.routes.get(`${seen.method} ${seen.service} ${path}`)?.(seen) ?? {
      status: 404,
      body: { statusCode: 404, message: "Resource not found" },
    };
    response.writeHead(answer.status ?? 200, { "content-type": "application/json" });
    response.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
  }
}

export interface TokenOptions {
  role?: "ADMIN" | "PROJECT_MANAGER" | "TEAM_LEAD" | "CONTRIBUTOR" | "VIEWER";
  /** Set: an OAuth-delegated token, audience [axial-projects, MCP resource]. Unset: a first-party token. */
  scope?: string;
  audience?: string | string[];
  expiresIn?: string | number;
  claims?: Record<string, unknown>;
}

export interface Harness {
  app: INestApplication;
  stub: UpstreamStub;
  token(options?: TokenOptions): Promise<string>;
  foreignToken(): Promise<string>;
  connect(token: string | undefined, era?: "modern" | "legacy"): Promise<Client>;
  connectEliciting(
    token: string,
    answer: { action: "accept" | "decline" | "cancel"; content?: Record<string, boolean> },
    asked?: string[],
  ): Promise<Client>;
  close(): Promise<void>;
}

/** Keys, stub services and environment first; then the real AppModule is imported and initialized. */
export async function startHarness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "axial-mcp-test-"));
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const foreign = await generateKeyPair("RS256", { extractable: true });
  const publicKeyPath = join(directory, "public.pem");
  await writeFile(publicKeyPath, await exportSPKI(publicKey), "utf8");
  const stub = new UpstreamStub();
  await stub.start();
  const base = `http://127.0.0.1:${stub.port}`;
  Object.assign(process.env, {
    NODE_ENV: "test",
    MCP_RESOURCE: RESOURCE,
    MCP_PUBLIC_KEY_PATH: publicKeyPath,
    MCP_JWT_ISSUER: ISSUER,
    MCP_JWT_AUDIENCE: AUDIENCE,
    PROJECTS_API_URL: `${base}/projects`,
    AUDIT_API_URL: `${base}/audit`,
    NOTIFICATIONS_API_URL: `${base}/notifications`,
    IDENTITY_API_URL: `${base}/identity`,
    MCP_ALLOWED_ORIGINS: "http://localhost:5173",
  });
  delete process.env.MCP_ACCESS_TOKEN;
  delete process.env.MCP_ACCESS_TOKEN_FILE;
  const { createApp } = await import("../../src/app.js");
  const app = await createApp();
  const clients: Client[] = [];

  const sign = (key: CryptoKey, options: TokenOptions = {}) =>
    new SignJWT({
      organizationId: ORG,
      role: options.role ?? "PROJECT_MANAGER",
      projectIds: [PROJECT],
      teamIds: [],
      source: "mcp",
      ...(options.scope === undefined ? {} : { scope: options.scope, client_id: "test-mcp-client" }),
      ...options.claims,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setSubject(USER)
      .setIssuer(ISSUER)
      .setAudience(options.audience ?? (options.scope === undefined ? AUDIENCE : [AUDIENCE, RESOURCE]))
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5m")
      .sign(key);

  return {
    app,
    stub,
    token: (options) => sign(privateKey, options),
    foreignToken: () => sign(foreign.privateKey),
    async connect(token, era = "modern") {
      const client = await connectMcpClient(app, { token, era });
      clients.push(client);
      return client;
    },
    async connectEliciting(token, answer, asked = []) {
      const http = app.get(McpHttpService, { strict: false });
      const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
        fetch: (input, init) => {
          const request = new Request(input, init);
          if (!request.headers.has("host")) request.headers.set("host", "localhost");
          const { pathname, search } = new URL(request.url);
          return http.fetch(request, {
            platformRequest: {
              method: request.method,
              url: pathname + search,
              headers: Object.fromEntries(request.headers),
            },
          });
        },
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      });
      const client = new Client(
        { name: "axial-test-eliciting", version: "1.0.0" },
        { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: { pin: "2026-07-28" } } },
      );
      client.setRequestHandler("elicitation/create", async (request) => {
        asked.push(request.params.message);
        return answer;
      });
      await client.connect(transport);
      clients.push(client);
      return client;
    },
    async close() {
      await Promise.all(clients.splice(0).map((client) => client.close()));
      await app.close();
      await stub.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** The first text block of a tool result. */
export function text(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const first = content.find((block) => block.type === "text");
  return first?.text ?? "";
}

/** The text of a prompt's first message. */
export function promptText(result: { messages: Array<{ content: unknown }> }): string {
  const content = result.messages[0]?.content as { type?: string; text?: string } | undefined;
  return content?.type === "text" ? (content.text ?? "") : "";
}

export function json<T>(result: unknown): T {
  return JSON.parse(text(result)) as T;
}

/* Fixtures shaped like ms-projects responses. */
const now = "2026-11-17T12:00:00.000Z";

export function projectFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT,
    organizationId: ORG,
    key: "CHK",
    name: "Checkout",
    description: "",
    color: null,
    status: "active",
    priority: "high",
    leadId: null,
    teamIds: [],
    startDate: null,
    endDate: null,
    archivedAt: null,
    version: 4,
    taskSequence: 3,
    createdBy: USER,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function taskFixture(number: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `0190f0f0-0000-7000-8000-0000000001${String(number).padStart(2, "0")}`,
    organizationId: ORG,
    projectId: PROJECT,
    number,
    ref: `CHK-${number}`,
    title: `Task ${number}`,
    description: "",
    type: "task",
    status: "todo",
    priority: "medium",
    assigneeId: null,
    teamId: null,
    epicId: null,
    sprintId: null,
    parentId: null,
    labels: [],
    acceptanceCriteria: [],
    estimate: 3,
    position: number,
    startDate: null,
    dueDate: null,
    completedAt: null,
    version: 2,
    createdBy: USER,
    createdAt: now,
    updatedAt: now,
    dependencies: [],
    ...overrides,
  };
}

export function sprintFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "0190f0f0-0000-7000-8000-000000000501",
    organizationId: ORG,
    projectId: PROJECT,
    name: "Sprint 1",
    goal: "Ship checkout",
    status: "active",
    startDate: "2026-11-10T00:00:00.000Z",
    endDate: "2026-11-24T00:00:00.000Z",
    startedAt: now,
    completedAt: null,
    version: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function page<T>(items: T[], total = items.length) {
  return { items, total, page: 1, pageSize: 100 };
}
