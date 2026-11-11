import { useState } from "react";
import { Icon } from "../components/Icon";
import { Empty, Field, Overlay, PageHead, Who } from "../components/ui";
import type {
  Notification,
  NotificationChannel,
  NotificationStatus,
  NotificationTemplate,
} from "../data/types";
import { useWorkspace } from "../data/workspace";
import { fmtDateTime, navigate, rel } from "../lib/format";

const CHANNELS: NotificationChannel[] = ["email", "whatsapp", "sms"];
const CHANNEL_META: Record<NotificationChannel, { label: string; icon: string }> = {
  email: { label: "E-mail", icon: "mail" },
  whatsapp: { label: "WhatsApp", icon: "wapp" },
  sms: { label: "SMS", icon: "sms" },
};
const STATUS_META: Record<NotificationStatus, { label: string; tone: "success" | "failed" | "pending" }> = {
  delivered: { label: "entregue", tone: "success" },
  accepted: { label: "aceito", tone: "success" },
  failed: { label: "falhou", tone: "failed" },
  pending: { label: "pendente", tone: "pending" },
  unknown: { label: "incerto", tone: "pending" },
};
const TABS: { id: string; label: string }[] = [
  { id: "history", label: "Histórico de envio" },
  { id: "prefs", label: "Preferências" },
  { id: "templates", label: "Templates" },
  { id: "providers", label: "Provedores" },
];

function Status({ status }: { status: NotificationStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`deliv-status ${meta.tone}`}>
      <Icon name={meta.tone === "failed" ? "alert" : meta.tone === "pending" ? "timer" : "check"} size={13} />
      {meta.label}
    </span>
  );
}

function Channel({ channel }: { channel: NotificationChannel }) {
  const meta = CHANNEL_META[channel];
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <Icon name={meta.icon} size={14} />
      {meta.label}
    </span>
  );
}

export function Notifications({ tab = "history" }: { tab?: string }) {
  const { db, me, can } = useWorkspace();
  const active = TABS.some((item) => item.id === tab) ? tab : "history";
  const [selected, setSelected] = useState<string | null>(null);
  const [provider, setProvider] = useState<NotificationChannel | null>(null);
  const mine = db.notifications.filter((item) => can("notif.manage") || item.toUserId === me.id);
  return (
    <>
      <PageHead
        title="Notificações multicanal"
        sub="Entregas por e-mail, WhatsApp e SMS (ms-notifications). Demonstração local — nenhuma mensagem real sai do navegador."
      />
      <div className="tabs" role="tablist" aria-label="Seções de notificações">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active === item.id}
            className={`tab${active === item.id ? " active" : ""}`}
            onClick={() => navigate(`/notifications/${item.id}`)}
          >
            {item.label}
            {item.id === "history" && <span className="cnt num">{mine.length}</span>}
          </button>
        ))}
      </div>
      {active === "history" && <History rows={mine} onOpen={setSelected} />}
      {active === "prefs" && <Preferences />}
      {active === "templates" && <Templates templates={db.notificationTemplates} />}
      {active === "providers" && <Providers onConfigure={setProvider} />}
      {selected && <NotificationDrawer id={selected} onClose={() => setSelected(null)} />}
      {provider && <ProviderModal channel={provider} onClose={() => setProvider(null)} />}
    </>
  );
}

function History({ rows, onOpen }: { rows: Notification[]; onOpen: (id: string) => void }) {
  const { can, act } = useWorkspace();
  if (!rows.length)
    return (
      <Empty
        icon="bell"
        title="Nenhuma notificação"
        sub="Atribua tarefas ou inicie sprints para gerar notificações."
      />
    );
  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Canal</th>
              <th>Assunto</th>
              <th>Destinatário</th>
              <th>Status</th>
              <th className="num">Tentativas</th>
              <th>Quando</th>
              <th className="actions-col" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((item) => (
              <tr key={item.id} className="row-click" onClick={() => onOpen(item.id)}>
                <td>
                  <Channel channel={item.channel} />
                </td>
                <td>
                  <button
                    type="button"
                    className="row-link"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(item.id);
                    }}
                  >
                    {item.subject}
                  </button>
                </td>
                <td>
                  <Who id={item.toUserId} />
                </td>
                <td>
                  <Status status={item.status} />
                </td>
                <td className="num">{item.attempts}</td>
                <td className="nowrap muted" style={{ fontSize: 11.5 }}>
                  {rel(item.ts)}
                </td>
                <td className="actions-col">
                  {item.status === "failed" && can("notif.manage") && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        act.resendNotification(item.id);
                      }}
                    >
                      <Icon name="refresh" size={12} />
                      Reenviar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Preferences() {
  const { db, can, act } = useWorkspace();
  const manage = can("notif.manage");
  return (
    <>
      {!manage && (
        <p className="subtle" style={{ fontSize: 12, marginBottom: 10 }}>
          Seu perfil pode visualizar, mas não alterar as preferências.
        </p>
      )}
      <div className="panel">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Evento</th>
                {CHANNELS.map((channel) => (
                  <th key={channel}>{CHANNEL_META[channel].label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {db.notificationTemplates.map((template) => {
                const prefs = db.notificationPreferences[template.event] ?? {
                  email: false,
                  whatsapp: false,
                  sms: false,
                };
                return (
                  <tr key={template.id}>
                    <td>
                      <b>{template.name}</b>
                      <div className="mono subtle" style={{ fontSize: 10.5 }}>
                        {template.event}
                      </div>
                    </td>
                    {CHANNELS.map((channel) =>
                      manage ? (
                        <td key={channel}>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={prefs[channel]}
                              aria-label={`${template.name} via ${CHANNEL_META[channel].label}`}
                              onChange={(event) =>
                                act.setNotifPref(template.event, channel, event.target.checked)
                              }
                            />
                            <span className="tr" />
                          </label>
                        </td>
                      ) : (
                        <td key={channel}>
                          {prefs[channel] ? (
                            <span className="chip ok">ligado</span>
                          ) : (
                            <span className="chip">desligado</span>
                          )}
                        </td>
                      ),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="subtle" style={{ fontSize: 12, marginTop: 10 }}>
        No serviço real, cada canal também exige um destino verificado por código antes do envio. A
        preferência por evento é aplicada além dessa confirmação e pode desligar um canal sem apagar a
        verificação.
      </p>
    </>
  );
}

function Templates({ templates }: { templates: NotificationTemplate[] }) {
  return (
    <>
      <div className="grid c2">
        {templates.map((template) => (
          <div className="panel" key={template.id}>
            <div className="panel-head">
              <h3>{template.name}</h3>
              <span className="spacer" />
              <span className="chip mono" style={{ fontSize: 10.5 }}>
                {template.event}
              </span>
            </div>
            <div className="panel-body">
              <div className="field">
                <span className="field-label">Assunto</span>
                <code className="code" style={{ whiteSpace: "normal" }}>
                  {template.subject}
                </code>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Corpo</span>
                <code className="code" style={{ whiteSpace: "normal" }}>
                  {template.body}
                </code>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="subtle" style={{ fontSize: 12, marginTop: 10 }}>
        Variáveis entre chaves ({`{ref}`}, {`{nome}`}, {`{projeto}`}…) são substituídas no envio. Os textos do
        serviço real são genéricos e não incluem conteúdo privado do projeto.
      </p>
    </>
  );
}

function Providers({ onConfigure }: { onConfigure: (channel: NotificationChannel) => void }) {
  const { db, can } = useWorkspace();
  return (
    <>
      <div className="grid c3">
        {CHANNELS.map((channel) => {
          const provider = db.notificationProviders[channel];
          return (
            <div className="panel" key={channel}>
              <div className="panel-head">
                <Icon name={CHANNEL_META[channel].icon} size={15} />
                <h3>{CHANNEL_META[channel].label}</h3>
                <span className="spacer" />
                {provider.configured ? (
                  <span className="chip ok">configurado</span>
                ) : (
                  <span className="chip danger">não configurado</span>
                )}
              </div>
              <div className="panel-body">
                <p className="muted" style={{ fontSize: 12 }}>
                  {provider.name}
                </p>
                {provider.configured ? (
                  <div className="mono subtle" style={{ fontSize: 11.5 }}>
                    remetente: {provider.from}
                  </div>
                ) : (
                  <p className="subtle" style={{ fontSize: 12 }}>
                    Envios por este canal falham até a configuração.
                  </p>
                )}
                {can("notif.manage") && (
                  <div style={{ marginTop: 10 }}>
                    <button type="button" className="btn btn-sm" onClick={() => onConfigure(channel)}>
                      <Icon name="settings" size={12} />
                      Configurar
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="subtle" style={{ fontSize: 12, marginTop: 10 }}>
        Em produção, credenciais e remetentes vêm do ambiente do serviço e nunca do navegador. Esta
        configuração é apenas uma simulação local.
      </p>
    </>
  );
}

function NotificationDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { db, can, act } = useWorkspace();
  const item = db.notifications.find((notification) => notification.id === id);
  if (!item) return null;
  return (
    <Overlay
      drawer
      title={`Notificação — ${CHANNEL_META[item.channel].label}`}
      onClose={onClose}
      foot={
        item.status === "failed" && can("notif.manage") ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => act.resendNotification(item.id)}
          >
            <Icon name="refresh" size={13} />
            Reenviar notificação
          </button>
        ) : undefined
      }
    >
      <div className="task-props">
        <span className="pl">Status</span>
        <Status status={item.status} />
        <span className="pl">Destinatário</span>
        <Who id={item.toUserId} />
        <span className="pl">Evento</span>
        <span className="mono" style={{ fontSize: 11.5 }}>
          {item.eventType}
        </span>
        <span className="pl">Tentativas</span>
        <span className="num">{item.attempts}</span>
        <span className="pl">Quando</span>
        <span>{fmtDateTime(item.ts)}</span>
      </div>
      {item.failReason && (
        <p className="err" role="alert">
          {item.failReason}
        </p>
      )}
      <div className="section-h">Assunto</div>
      <p>{item.subject}</p>
      <div className="section-h">Mensagem</div>
      <p style={{ whiteSpace: "pre-wrap" }}>{item.body}</p>
    </Overlay>
  );
}

function ProviderModal({ channel, onClose }: { channel: NotificationChannel; onClose: () => void }) {
  const { db, act } = useWorkspace();
  const provider = db.notificationProviders[channel];
  const [from, setFrom] = useState(provider.from);
  const [host, setHost] = useState(provider.host);
  const [error, setError] = useState("");
  return (
    <Overlay
      title={`Configurar ${provider.name}`}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (!from.trim()) {
                setError("Informe o remetente");
                return;
              }
              act.setProvider(channel, { from, host, configured: true });
              onClose();
            }}
          >
            Salvar configuração
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 12 }}>
        Configuração simulada — nenhuma credencial é usada nem armazenada fora do navegador.
      </p>
      <Field label="Remetente" error={error}>
        <input
          className="input"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setError("");
          }}
          placeholder={channel === "email" ? "noreply@empresa.dev" : "+55 11 90000-0000"}
        />
      </Field>
      <Field label="Servidor / gateway">
        <input
          className="input mono"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder={channel === "email" ? "api.resend.com" : "api.gateway.exemplo"}
        />
      </Field>
    </Overlay>
  );
}
