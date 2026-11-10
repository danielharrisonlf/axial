const API_BASE = "https://api.smsgo.com.br/v1";
const TIMEOUT_MS = 10_000;

type Input = { id: string; destination: string; eventType: string };
type Config = { apiKey: string; smsTypeId: number };

async function request(url: string, options: RequestInit, stage: string): Promise<unknown> {
  try {
    const response = await fetch(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`SMSGo ${stage} HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error(`SMSGo ${stage} invalid response`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /^SMSGo (authentication|send) (HTTP \d{3}|invalid response)$/.test(error.message)
    ) {
      throw error;
    }
    throw new Error(`SMSGo ${stage} request failed`);
  }
}

function field(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const result = (value as Record<string, unknown>)[key];
  return typeof result === "string" && result.trim() && !/[\r\n]/.test(result) ? result : undefined;
}

/** A reference permits reconciliation; SMSGo does not document it as an idempotency key. */
export async function sendSmsGo(input: Input, config: Config): Promise<string> {
  if (
    !config.apiKey.trim() ||
    /[\r\n]/.test(config.apiKey) ||
    !Number.isSafeInteger(config.smsTypeId) ||
    config.smsTypeId <= 0
  )
    throw new Error("Invalid SMSGo configuration");
  if (!input.id.trim() || !/^\+[1-9]\d{1,14}$/.test(input.destination) || !input.eventType.trim()) {
    throw new Error("Invalid SMSGo input");
  }
  const auth = await request(
    `${API_BASE}/auth/token`,
    {
      method: "GET",
      headers: { "SMSGo-key": config.apiKey },
    },
    "authentication",
  );
  const token = field(auth, "token");
  if (!token) throw new Error("SMSGo authentication invalid response");

  const result = await request(
    `${API_BASE}/sms/send/single`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        phone: input.destination,
        message: "Axial: voce tem uma atualizacao de tarefa. Acesse o aplicativo para conferir.",
        reference: input.id,
        sms_type_id: config.smsTypeId,
      }),
    },
    "send",
  );
  const id = field(result, "id");
  if (!id) throw new Error("SMSGo send invalid response");
  return id;
}
