/** Sends an already approved template without components. Acceptance is not delivery. */
export async function sendMeta(
  input: { id: string; destination: string; eventType: string },
  config: {
    accessToken: string;
    phoneNumberId: string;
    templateName: string;
    languageCode: string;
    graphVersion: string;
  },
): Promise<string> {
  if (
    !config.accessToken.trim() ||
    /[\r\n]/.test(config.accessToken) ||
    !/^\d+$/.test(config.phoneNumberId) ||
    !/^v\d+\.\d+$/.test(config.graphVersion) ||
    !config.templateName.trim() ||
    !config.languageCode.trim() ||
    !/^\+?\d+$/.test(input.destination)
  ) {
    throw new Error("Invalid Meta WhatsApp configuration or destination");
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.destination,
          type: "template",
          template: { name: config.templateName, language: { code: config.languageCode } },
        }),
      },
    );
    if (!response.ok) {
      throw new Error("Meta WhatsApp request rejected");
    }
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("messages" in result) ||
      !Array.isArray(result.messages) ||
      typeof result.messages[0]?.id !== "string" ||
      !result.messages[0].id.trim()
    ) {
      throw new Error("Meta WhatsApp response missing message ID");
    }
    return result.messages[0].id;
  } catch {
    // Do not expose provider payloads, credentials, destinations, or network error details.
    throw new Error("Meta WhatsApp send failed");
  }
}
