const FAILURE = "Resend request failed";

/** Returns the provider's accepted email ID; acceptance does not imply delivery. */
export async function sendResend(
  input: { id: string; destination: string; eventType: string },
  config: { apiKey: string; from: string },
): Promise<string> {
  try {
    if (
      !/^[\x21-\x7e]{1,256}$/.test(input.id) ||
      !input.destination.trim() ||
      /[\r\n]/.test(input.destination) ||
      !config.from.trim() ||
      /[\r\n]/.test(config.from) ||
      !config.apiKey.trim() ||
      /\s/.test(config.apiKey)
    )
      throw new Error(FAILURE);

    const taskEvent = input.eventType.startsWith("task.");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.id,
      },
      body: JSON.stringify({
        from: config.from,
        to: [input.destination],
        subject: taskEvent ? "Atualização de tarefa no Axial" : "Notificação do Axial",
        text: taskEvent
          ? "Há uma atualização em uma tarefa atribuída a você. Acesse o Axial para conferir."
          : "Há uma atualização para você. Acesse o Axial para conferir.",
      }),
    });
    if (!response.ok) throw new Error(FAILURE);
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("id" in result) ||
      typeof result.id !== "string" ||
      !result.id.trim() ||
      result.id.length > 200 ||
      /[\r\n]/.test(result.id)
    )
      throw new Error(FAILURE);
    return result.id;
  } catch {
    // Do not expose provider bodies, request details, destinations, or credentials.
    throw new Error(FAILURE);
  }
}
