/** Catalog shared by the HTTP read endpoints. Texts are generic and never include project data. */
export const channels = ["email", "sms", "whatsapp"] as const;
export type Channel = (typeof channels)[number];

export interface NotificationTemplate {
  event: string;
  name: string;
  subject: string;
  body: string;
}

/**
 * The worker creates deliveries for task.* events (except task.deleted) that carry an
 * assignee UUID. The catalog lists the task events used by the rest of the platform.
 */
export const notificationTemplates: readonly NotificationTemplate[] = [
  {
    event: "task.assigned.v1",
    name: "Tarefa atribuída",
    subject: "Atualização de tarefa no Axial",
    body: "Há uma atualização em uma tarefa atribuída a você. Acesse o Axial para conferir.",
  },
  {
    event: "task.updated.v1",
    name: "Tarefa atualizada",
    subject: "Atualização de tarefa no Axial",
    body: "Há uma atualização em uma tarefa atribuída a você. Acesse o Axial para conferir.",
  },
  {
    event: "task.status_changed.v1",
    name: "Status da tarefa alterado",
    subject: "Atualização de tarefa no Axial",
    body: "Há uma atualização em uma tarefa atribuída a você. Acesse o Axial para conferir.",
  },
  {
    event: "task.completed.v1",
    name: "Tarefa concluída",
    subject: "Atualização de tarefa no Axial",
    body: "Há uma atualização em uma tarefa atribuída a você. Acesse o Axial para conferir.",
  },
  {
    event: "task.blocked.v1",
    name: "Tarefa bloqueada",
    subject: "Atualização de tarefa no Axial",
    body: "Há uma atualização em uma tarefa atribuída a você. Acesse o Axial para conferir.",
  },
];

export const notificationEvents: ReadonlySet<string> = new Set(
  notificationTemplates.map((template) => template.event),
);

export interface ProviderStatus {
  channel: Channel;
  provider: string;
  configured: boolean;
  verification: boolean;
}

function complete(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.every((key) => Boolean(env[key]?.trim()));
}

/**
 * Reports whether each channel has complete configuration. Secrets and destinations are
 * never returned; an incomplete channel is reported as not configured.
 */
export function providerStatus(env: NodeJS.ProcessEnv = process.env): ProviderStatus[] {
  const enabled = env.NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION === "true";
  const gateway = enabled && complete(env, ["NOTIFICATIONS_PROVIDER_URL", "NOTIFICATIONS_PROVIDER_TOKEN"]);
  const pepper = Boolean(env.NOTIFICATIONS_VERIFICATION_PEPPER?.trim());
  return channels.map((channel) => {
    const direct = complete(
      env,
      channel === "email"
        ? ["RESEND_API_KEY", "RESEND_FROM"]
        : channel === "sms"
          ? ["SMSGO_API_KEY", "SMSGO_SMS_TYPE_ID"]
          : [
              "META_ACCESS_TOKEN",
              "META_PHONE_NUMBER_ID",
              "META_TEMPLATE_NAME",
              "META_LANGUAGE_CODE",
              "META_GRAPH_VERSION",
            ],
    );
    return {
      channel,
      provider: gateway
        ? "HTTPS gateway"
        : channel === "email"
          ? "Resend"
          : channel === "sms"
            ? "SMSGo"
            : "WhatsApp Cloud API",
      configured: gateway || (enabled && direct),
      verification:
        pepper && env[`NOTIFICATIONS_VERIFY_${channel.toUpperCase()}` as keyof NodeJS.ProcessEnv] === "true",
    };
  });
}
