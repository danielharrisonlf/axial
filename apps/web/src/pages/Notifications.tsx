import { useState } from "react";
import { Icon } from "../components/Icon";
import { Empty, Field, Overlay, PageHead, Switch, TabNav, Who } from "../components/ui";
import type { Notification, NotificationChannel, NotificationStatus } from "../data/types";
import { useWorkspace } from "../data/workspace";
import { fmtDateTime, rel } from "../lib/format";

const CHANNELS: NotificationChannel[] = ["email", "whatsapp", "sms"];
const CHANNEL_META: Record<NotificationChannel, { label: string; icon: string }> = {
  email: { label: "E-mail", icon: "mail" },
  whatsapp: { label: "WhatsApp", icon: "wapp" },
  sms: { label: "SMS", icon: "sms" },
};
const STATUS_META: Record<
  NotificationStatus,
  { label: string; tone: "success" | "failed" | ""; icon: string }
> = {
  delivered: { label: "Entregue", tone: "success", icon: "check" },
  accepted: { label: "Aceito", tone: "success", icon: "check" },
  failed: { label: "Falhou", tone: "failed", icon: "alert" },
  pending: { label: "Pendente", tone: "", icon: "timer" },
  unknown: { label: "Incerto", tone: "", icon: "timer" },
};
const TABS = ["history", "prefs", "templates", "providers"];

/** Delivery status: icon + text (never color alone). The drawer shows the failure reason in place of "Falhou". */
function Status({ item, reason = false }: { item: Notification; reason?: boolean }) {
  const meta = STATUS_META[item.status];
  return (
    <span className={`deliv-status${meta.tone ? ` ${meta.tone}` : ""}`}>
      <Icon name={meta.icon} size={13} />
      {reason && item.status === "failed" && item.failReason ? item.failReason : meta.label}
    </span>
  );
}

export function Notifications({ tab = "history" }: { tab?: string }) {
  const { db, me, can } = useWorkspace();
  const active = TABS.includes(tab) ? tab : "history";
  const [selected, setSelected] = useState<string | null>(null);
  const [provider, setProvider] = useState<NotificationChannel | null>(null);
  // own deliveries; whoever manages people or reads the audit also sees the organization's
  const all = can("user.manage") || can("audit.view");
  const mine = db.notifications.filter((item) => {
    if (item.toUserId === me.id) return true;
    if (!all) return false;
    const user = db.users.find((u) => u.id === item.toUserId);
    return !!user && user.orgId === me.orgId;
  });
  return (
    <>
      <PageHead
        title="Notificações multicanal"
        sub="Envios por e-mail, WhatsApp e SMS: histórico com reenvio, preferências por evento, templates e provedores de cada canal."
      />
      <TabNav
        label="Seções de notificações"
        items={[
          { key: "history", label: `Histórico de envio (${mine.length})` },
          { key: "prefs", label: "Preferências" },
          { key: "templates", label: "Templates" },
          { key: "providers", label: "Provedores" },
        ]}
        active={active}
        base="/notifications/"
      />
      {active === "history" && <History rows={mine} onOpen={setSelected} />}
      {active === "prefs" && <Preferences />}
      {active === "templates" && <Templates />}
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
                  <span className="cell-main tight">
                    <Icon name={CHANNEL_META[item.channel].icon} size={14} />
                    {CHANNEL_META[item.channel].label}
                  </span>
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
                  <Status item={item} />
                </td>
                <td className="num">{item.attempts}</td>
                <td className="nowrap muted t12">
                  <time dateTime={item.ts}>{rel(item.ts)}</time>
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
        <p className="ro-note page-lead">
          <Icon name="block" size={12} />
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
                      <div className="mono subtle t12">{template.event}</div>
                    </td>
                    {CHANNELS.map((channel) => (
                      <td key={channel}>
                        {manage ? (
                          <Switch
                            checked={prefs[channel]}
                            label={`${template.name} via ${CHANNEL_META[channel].label}`}
                            onChange={(value) => act.setNotifPref(template.event, channel, value)}
                          />
                        ) : prefs[channel] ? (
                          <span className="chip ok">Ligado</span>
                        ) : (
                          <span className="chip">Desligado</span>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Templates() {
  const { db } = useWorkspace();
  return (
    <>
      <div className="grid c2">
        {db.notificationTemplates.map((template) => (
          <div className="panel" key={template.id}>
            <div className="panel-head">
              <h2>{template.name}</h2>
              <span className="spacer" />
              <span className="chip mono t12">{template.event}</span>
            </div>
            <div className="panel-body">
              <div className="field">
                <span className="fl">Assunto</span>
                <code className="code wrap">{template.subject}</code>
              </div>
              <div className="field">
                <span className="fl">Corpo</span>
                <code className="code wrap">{template.body}</code>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="page-note">
        Variáveis entre chaves ({"{ref}, {nome}, {projeto}"}…) são substituídas no envio.
      </p>
    </>
  );
}

function Providers({ onConfigure }: { onConfigure: (channel: NotificationChannel) => void }) {
  const { db, can } = useWorkspace();
  return (
    <div className="grid c3">
      {CHANNELS.map((channel) => {
        const provider = db.notificationProviders[channel];
        return (
          <div className="panel" key={channel}>
            <div className="panel-head">
              <Icon name={CHANNEL_META[channel].icon} size={15} />
              <h2>{CHANNEL_META[channel].label}</h2>
              <span className="spacer" />
              {provider.configured ? (
                <span className="chip ok">Configurado</span>
              ) : (
                <span className="chip danger">Não configurado</span>
              )}
            </div>
            <div className="panel-body">
              <p className="muted t12">{provider.name}</p>
              {provider.configured ? (
                <div className="mono subtle t12">remetente: {provider.from}</div>
              ) : (
                <p className="subtle t12">Envios por este canal falham até a configuração.</p>
              )}
              {can("notif.manage") && (
                <div className="mt-3">
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
  );
}

function NotificationDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { db, can, act } = useWorkspace();
  const item = db.notifications.find((notification) => notification.id === id);
  if (!item) return null;
  return (
    <Overlay
      drawer
      label="Notificação"
      head={
        <h2 className="drawer-title">
          <Icon name="bell" size={16} />
          <b>Notificação — {CHANNEL_META[item.channel].label}</b>
        </h2>
      }
      onClose={onClose}
    >
      <div className="task-props">
        <span className="pl">Status</span>
        <Status item={item} reason />
        <span className="pl">Destinatário</span>
        <Who id={item.toUserId} />
        <span className="pl">Evento</span>
        <span className="mono t12">{item.eventType}</span>
        <span className="pl">Tentativas</span>
        <span className="num">{item.attempts}</span>
        <span className="pl">Quando</span>
        <span>{fmtDateTime(item.ts)}</span>
      </div>
      <div className="section-h">Assunto</div>
      <p>{item.subject}</p>
      <div className="section-h">Mensagem</div>
      <p className="pre-wrap">{item.body}</p>
      {item.status === "failed" && can("notif.manage") && (
        <div className="mt-3">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              act.resendNotification(item.id);
              onClose();
            }}
          >
            <Icon name="refresh" size={13} />
            Reenviar notificação
          </button>
        </div>
      )}
    </Overlay>
  );
}

function ProviderModal({ channel, onClose }: { channel: NotificationChannel; onClose: () => void }) {
  const { db, act } = useWorkspace();
  const provider = db.notificationProviders[channel];
  const [from, setFrom] = useState(provider.from);
  const [host, setHost] = useState(provider.host);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (!from.trim()) {
      setError("Informe o remetente");
      return;
    }
    act.setProvider(channel, { from: from.trim(), host: host.trim(), configured: true });
    onClose();
  };
  return (
    <Overlay
      title={`Configurar ${provider.name}`}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            Salvar configuração
          </button>
        </>
      }
    >
      <Field label="Remetente" required error={error}>
        <input
          className="input"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setError(null);
          }}
          placeholder={channel === "email" ? "noreply@empresa.dev" : "+55 11 90000-0000"}
        />
      </Field>
      <Field label="Servidor / gateway">
        <input
          className="input mono"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder={channel === "email" ? "smtp.empresa.dev" : "api.gateway.exemplo"}
        />
      </Field>
    </Overlay>
  );
}
