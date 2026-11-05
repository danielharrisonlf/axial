import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Priority, Project, Task, TaskStatus, User } from "../data/types";
import { useWorkspace } from "../data/workspace";
import { daysLeft, isOverdue, PRIO_META, projectProgress, STATUS_META } from "../lib/format";
import { Icon } from "./Icon";
export type TaskDefaults = Partial<Task>;
export const UIContext = createContext<{
  project: (p?: Project) => void;
  task: (d?: TaskDefaults) => void;
  openTask: (id: string) => void;
  confirm: (title: string, message: string, action: () => void, label?: string) => void;
}>({ project: () => {}, task: () => {}, openTask: () => {}, confirm: () => {} });
export const useUI = () => useContext(UIContext);
export const roles: Record<string, string> = {
  admin: "Administrador da organização",
  pm: "Gestor de projetos",
  lead: "Líder de equipe",
  dev: "Desenvolvedor",
  viewer: "Visualizador / Auditor",
};
export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
export function Empty({
  icon = "tasks",
  title,
  sub,
  children,
}: {
  icon?: string;
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="e-ic">
        <Icon name={icon} size={22} />
      </div>
      <b>{title}</b>
      {sub && <p>{sub}</p>}
      {children}
    </div>
  );
}
export function Avatar({ user, size = "" }: { user?: User | null; size?: string }) {
  return (
    <span
      className={`avatar ${size}`}
      data-tip={user?.name || "Sem responsável"}
      style={
        user
          ? ({ "--av": user.color } as CSSProperties)
          : { background: "var(--surface-2)", border: "1px dashed var(--border-2)" }
      }
    >
      {user?.initials}
    </span>
  );
}
export function Who({ id }: { id?: string | null }) {
  const { db } = useWorkspace();
  const u = db.users.find((x) => x.id === id);
  return u ? (
    <span className="who-cell">
      <Avatar user={u} size="sm" />
      <span className="nm">{u.name}</span>
    </span>
  ) : (
    <span className="muted">—</span>
  );
}
export function Progress({ value }: { value: number }) {
  return (
    <div
      className={`progress${value === 100 ? " ok" : ""}`}
      role="progressbar"
      aria-label="Progresso"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  return (
    <span style={{ display: "inline-flex", flex: "none", color: STATUS_META[status].color }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        {status === "done" ? (
          <>
            <circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" />
            <path d="m8.6 12.2 2.3 2.3 4.5-4.7" stroke="var(--surface)" strokeWidth="2" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="7" strokeDasharray={status === "backlog" ? "3.2 3.2" : undefined} />
            {status === "in_progress" && (
              <path d="M12 12V5.4A6.6 6.6 0 0 1 12 18.6z" fill="currentColor" stroke="none" />
            )}
            {status === "in_review" && (
              <path d="M12 12V5.4A6.6 6.6 0 1 1 5.4 12z" fill="currentColor" stroke="none" />
            )}
          </>
        )}
      </svg>
    </span>
  );
}
export function StatusChip({ status }: { status: TaskStatus }) {
  return (
    <span className="status-chip">
      <StatusIcon status={status} />
      {STATUS_META[status].label}
    </span>
  );
}
export function PriorityChip({ priority, bare = false }: { priority: Priority; bare?: boolean }) {
  const m = PRIO_META[priority];
  const paths = {
    urgent: "m6 11 6-5 6 5M6 17l6-5 6 5",
    high: "m6 14.5 6-5 6 5",
    medium: "M6 9.5h12M6 14.5h12",
    low: "m6 9.5 6 5 6-5",
  };
  return (
    <span className="prio" style={{ color: m.color }} data-tip={bare ? m.label : undefined}>
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={paths[priority]} />
      </svg>
      {!bare && m.label}
    </span>
  );
}
export function TypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  const meta: Record<string, [string, string]> = {
    task: ["tasks", "var(--accent)"],
    bug: ["bug", "var(--danger)"],
    subtask: ["subtask", "var(--ink-2)"],
    epic: ["epic", "var(--violet)"],
  };
  const m = meta[type] || ["tasks", "var(--accent)"];
  return <Icon name={m[0]} size={size} style={{ color: m[1] }} />;
}
export function LabelChip({ name }: { name: string }) {
  const colors: Record<string, string> = {
    backend: "#2B5FD9",
    frontend: "#B23A78",
    mobile: "#6D4FC4",
    infra: "#0E7490",
    dados: "#9A5B00",
    ux: "#3D7068",
    seguranca: "#BE3030",
    performance: "#7A5C2E",
    documentacao: "#4A6572",
    cliente: "#1D7A4C",
  };
  return (
    <span className="label-chip" style={{ "--lc": colors[name] || "var(--ink-3)" } as CSSProperties}>
      {name}
    </span>
  );
}
export function ProjectStatus({ p }: { p: Project }) {
  const m: Record<string, [string, string]> = {
    active: ["accent", "Ativo"],
    paused: ["warn", "Pausado"],
    done: ["ok", "Concluído"],
    archived: ["", "Arquivado"],
  };
  const [c, label] = m[p.archived ? "archived" : p.status] || ["accent", "Ativo"];
  return <span className={`chip ${c}`}>{label}</span>;
}
export function Risk({ p }: { p: Project }) {
  const { db } = useWorkspace();
  const ts = db.tasks.filter((t) => t.projectId === p.id && !t.parentId);
  const late = ts.filter(isOverdue).length,
    blocked = ts.filter((t) => t.blockedBy.length && t.status !== "done").length,
    target = daysLeft(p.targetDate) ?? 99,
    prog = projectProgress(db, p.id);
  const risk =
    p.status === "done"
      ? ["ok", "Entregue"]
      : late >= 3 || (target < 15 && prog < 60) || blocked >= 2
        ? ["danger", "Em risco"]
        : late >= 1 || (target < 30 && prog < 50)
          ? ["warn", "Atenção"]
          : ["ok", "Saudável"];
  return <span className={`chip ${risk[0]}`}>{risk[1]}</span>;
}
export type Option = { value: string; label: string };
export function Select({
  value,
  onChange,
  options,
  label,
  disabled,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  label?: string;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <select
      className="select"
      style={style}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
export function Field({
  label,
  hint,
  wide = false,
  error,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  error?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={`field${wide ? " span2" : ""}${error ? " invalid" : ""}`}>
      <span className="field-label" id={id}>
        {label}
      </span>
      <fieldset className="field-control" aria-labelledby={id}>
        {children}
      </fieldset>
      {hint && <div className="hint">{hint}</div>}
      {error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
export function Overlay({
  title,
  onClose,
  children,
  foot,
  wide = false,
  drawer = false,
  headActions,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode;
  wide?: boolean;
  drawer?: boolean;
  headActions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    const shell = document.querySelector<HTMLElement>(".shell");
    const oldInert = shell?.inert;
    if (shell) shell.inert = true;
    const focus = () =>
      root
        ?.querySelector<HTMLElement>(
          'input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled),[tabindex="0"]',
        )
        ?.focus();
    focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab" && root) {
        const els = Array.from(
          root.querySelectorAll<HTMLElement>(
            'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        ).filter((el) => el.getClientRects().length);
        if (!els.length) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0]?.focus();
        }
      }
    };
    const outside = (e: PointerEvent) => {
      if (e.target instanceof HTMLElement && e.target.classList.contains("modal")) close.current();
    };
    document.addEventListener("keydown", handler);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", handler);
      document.removeEventListener("pointerdown", outside);
      if (shell) shell.inert = oldInert ?? false;
      previous?.focus();
    };
  }, []);
  const content = (
    <div
      ref={ref}
      className={drawer ? "drawer" : `modal-card${wide ? " wide" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className={drawer ? "drawer-head" : "modal-head"}>
        <h3 id={titleId}>{title}</h3>
        {!drawer && <span className="grow" aria-hidden="true" />}
        <span className="spacer" />
        {headActions}
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Fechar" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className={drawer ? "drawer-body" : "modal-body"}>{children}</div>
      {foot && <div className={drawer ? "drawer-foot" : "modal-foot"}>{foot}</div>}
    </div>
  );
  return createPortal(
    <>
      <button
        type="button"
        className="backdrop"
        tabIndex={-1}
        aria-label="Fechar diálogo"
        onClick={onClose}
      />
      {drawer ? content : <div className="modal">{content}</div>}
    </>,
    document.body,
  );
}
export type MenuItem = {
  label: string;
  icon?: string;
  sub?: string;
  checked?: boolean;
  danger?: boolean;
  node?: ReactNode;
  onClick: () => void;
};
export function MenuButton({
  label,
  children,
  items,
  className = "btn btn-ghost btn-icon btn-sm",
}: {
  label: string;
  children: ReactNode;
  items: (MenuItem | string)[];
  className?: string;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rect) return;
    const handle = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node))
        setRect(null);
    };
    document.addEventListener("pointerdown", handle);
    const firstItem = menu.current?.querySelector<HTMLButtonElement>("button");
    (firstItem || menu.current)?.focus();
    return () => {
      document.removeEventListener("pointerdown", handle);
    };
  }, [rect]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!rect}
        onClick={(e) => {
          e.stopPropagation();
          setRect(rect ? null : e.currentTarget.getBoundingClientRect());
        }}
      >
        {children}
      </button>
      {rect &&
        createPortal(
          <div
            ref={menu}
            className="menu"
            role="menu"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setRect(null);
                btn.current?.focus();
                return;
              }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                const els = Array.from(
                  e.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'),
                );
                const i = els.indexOf(document.activeElement as HTMLButtonElement);
                els[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? els.length - 1
                      : e.key === "ArrowDown"
                        ? (i + 1) % els.length
                        : (i - 1 + els.length) % els.length
                ]?.focus();
              }
            }}
            style={{
              top: Math.min(rect.bottom + 4, window.innerHeight - 220),
              right: Math.max(8, window.innerWidth - rect.right),
            }}
          >
            {items.map((it) =>
              typeof it === "string" ? (
                it === "sep" ? (
                  <div className="menu-sep" key={it} />
                ) : (
                  <div key={it} className="menu-head">
                    {it}
                  </div>
                )
              ) : (
                <button
                  type="button"
                  key={it.label}
                  role="menuitem"
                  className={`menu-item${it.danger ? " danger" : ""}`}
                  aria-current={it.checked || undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRect(null);
                    btn.current?.focus();
                    it.onClick();
                  }}
                >
                  {it.node || (it.icon && <Icon name={it.icon} size={14} />)}
                  <span className="grow">
                    {it.label}
                    {it.sub && <span className="mi-sub">{it.sub}</span>}
                  </span>
                  {it.checked && <Icon name="check" size={13} />}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
