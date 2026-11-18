import {
  type CSSProperties,
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Priority, Project, Task, TaskStatus, Toast, User } from "../data/types";
import { useWorkspace } from "../data/workspace";
import {
  catVar,
  dueText,
  dueTone,
  isOverdue,
  LABEL_META,
  labelName,
  PRIO_META,
  projectRisk,
  ROLE_LABEL,
  rel,
  STATUS_META,
  TYPE_META,
} from "../lib/format";
import { Icon } from "./Icon";

/* ==========================================================================
   Contexto de interface (modais, drawer de tarefa, confirmação)
   ========================================================================== */
export type TaskDefaults = Partial<Task>;
export interface ConfirmOptions {
  title: string;
  message: string;
  label?: string;
  /** Destructive action: confirm button uses btn-danger. */
  danger?: boolean;
  action: () => void;
}
export const UIContext = createContext<{
  project: (p?: Project) => void;
  task: (d?: TaskDefaults) => void;
  openTask: (id: string) => void;
  /** Task currently open in the inspector (cards and rows mark it with aria-current). */
  openTaskId: string | null;
  confirm: (options: ConfirmOptions) => void;
}>({ project: () => {}, task: () => {}, openTask: () => {}, openTaskId: null, confirm: () => {} });
export const useUI = () => useContext(UIContext);
export const roles: Record<string, string> = ROLE_LABEL;

/* ==========================================================================
   Live region dedicada (o conteúdo da página nunca é live region)
   ========================================================================== */
export function LiveRegions() {
  return (
    <>
      <div id="live-polite" className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
      <div id="live-assertive" className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" />
    </>
  );
}
let announceTimer: ReturnType<typeof setTimeout> | undefined;
/** Speaks a short message through the dedicated live region. */
export function announce(message: string, assertive = false) {
  const el = document.getElementById(assertive ? "live-assertive" : "live-polite");
  if (!el || !message) return;
  el.textContent = "";
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    el.textContent = message;
  }, 30);
}

/* ==========================================================================
   Pilha de camadas: modal, drawer, menu e navegação móvel.
   Esc fecha só a camada do topo; diálogos prendem o Tab e deixam o fundo
   inerte; ao fechar, o foco volta ao gatilho.
   ========================================================================== */
type LayerKind = "modal" | "drawer" | "menu" | "nav";
interface Layer {
  kind: LayerKind;
  el: () => HTMLElement | null;
  close: () => void;
  trigger: HTMLElement | null;
  onKey?: (e: KeyboardEvent) => boolean;
}
const layers: Layer[] = [];
const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const isDialog = (l: Layer) => l.kind === "modal" || l.kind === "drawer";
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[inert]") && (el.getClientRects().length > 0 || el === document.activeElement),
  );
}
function syncInert() {
  const app = document.getElementById("app-shell");
  const dialogs = layers.filter(isDialog);
  // the off-canvas nav makes only .main inert (the sidebar is inside the shell); see App
  if (app) app.inert = dialogs.length > 0;
  dialogs.forEach((l, i) => {
    const el = l.el();
    if (el) el.inert = i < dialogs.length - 1;
  });
}
function focusFallback() {
  const target =
    document.querySelector<HTMLElement>("#conteudo h1") ??
    document.getElementById("conteudo") ??
    document.body;
  target.focus({ preventScroll: true });
}
function returnFocus(trigger: HTMLElement | null, retry = true) {
  if (trigger?.isConnected && trigger !== document.body) {
    if (!trigger.closest("[inert]")) {
      trigger.focus({ preventScroll: true });
      return;
    }
    // the layer that made it inert may be leaving in this same commit (e.g. the off-canvas
    // navigation removes `inert` from .main): try again once the commit has finished
    if (retry) {
      queueMicrotask(() => returnFocus(trigger, false));
      return;
    }
  }
  const top = layers.at(-1)?.el();
  const first = top ? focusablesIn(top)[0] : undefined;
  if (first) first.focus();
  else focusFallback();
}
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (e) => {
      const top = layers.at(-1);
      if (!top) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        top.close();
        return;
      }
      if (top.onKey?.(e)) return;
      if (e.key === "Tab") {
        if (top.kind === "menu") {
          // APG: Tab fecha o menu e segue a partir do gatilho
          top.close();
          return;
        }
        const root = top.el();
        if (!root) return;
        const list = focusablesIn(root);
        if (!list.length) {
          e.preventDefault();
          root.focus();
          return;
        }
        const first = list[0];
        const last = list.at(-1);
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !root.contains(active))) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && (active === last || !root.contains(active))) {
          e.preventDefault();
          first?.focus();
        }
      }
    },
    true,
  );
}
/** z-index of the next dialog: --z-modal (95) + 2 per dialog already open (CSS token, not a literal). */
function nextDialogZ(): number {
  const base = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--z-modal"), 10);
  return (Number.isFinite(base) ? base : 95) + 2 * layers.filter(isDialog).length;
}
export const topLayerKind = (): LayerKind | null => layers.at(-1)?.kind ?? null;
/**
 * Registers an open layer while the component is mounted. Unmounting removes it and
 * returns focus to the element that was focused when it opened (unless `restore` is off).
 */
export function useLayer(
  kind: LayerKind,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: {
    onKey?: (e: KeyboardEvent) => boolean;
    restore?: RefObject<boolean>;
    trigger?: HTMLElement | null;
  } = {},
) {
  const close = useRef(onClose);
  close.current = onClose;
  const onKey = useRef(options.onKey);
  onKey.current = options.onKey;
  const restore = options.restore;
  const explicitTrigger = options.trigger;
  useLayoutEffect(() => {
    const trigger =
      explicitTrigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const layer: Layer = {
      kind,
      el: () => ref.current,
      close: () => close.current(),
      trigger,
      onKey: (e) => onKey.current?.(e) ?? false,
    };
    layers.push(layer);
    syncInert();
    return () => {
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
      syncInert();
      if (restore?.current !== false) returnFocus(layer.trigger);
    };
  }, [kind, ref, restore, explicitTrigger]);
}

/* ==========================================================================
   Modal e drawer
   ========================================================================== */
export function Overlay({
  title,
  head,
  label,
  onClose,
  children,
  foot,
  wide = false,
  drawer = false,
  alert = false,
  headActions,
  initialFocus = "first",
}: {
  /** Modal title (h2). For a drawer without `head`, also its visible title. */
  title?: ReactNode;
  /** Custom drawer header content (crumbs); `label` then names the dialog. */
  head?: ReactNode;
  label?: string;
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode;
  wide?: boolean;
  drawer?: boolean;
  /** Confirmation dialog (role=alertdialog). */
  alert?: boolean;
  headActions?: ReactNode;
  /** "first" focuses the first field or the primary action; "dialog" the dialog itself;
   * "cancel" the first footer action (destructive confirmations: Enter never confirms by accident). */
  initialFocus?: "first" | "dialog" | "cancel";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [z] = useState(nextDialogZ);
  useLayer(drawer ? "drawer" : "modal", ref, onClose);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (drawer || initialFocus === "dialog") {
      root.focus({ preventScroll: true });
      return;
    }
    if (initialFocus === "cancel") {
      (root.querySelector<HTMLElement>(".modal-foot .btn") ?? root).focus({ preventScroll: true });
      return;
    }
    const first =
      root.querySelector<HTMLElement>(
        ".modal-body input:not([disabled]):not([type=checkbox]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])",
      ) ?? root.querySelector<HTMLElement>(".modal-foot .btn:last-child");
    (first ?? root).focus({ preventScroll: true });
  }, [drawer, initialFocus]);
  const labelled = head ? { "aria-label": label } : { "aria-labelledby": titleId };
  const closeBtn = (
    <button type="button" className="btn btn-ghost btn-icon" aria-label="Fechar" onClick={onClose}>
      <Icon name="x" />
    </button>
  );
  if (drawer)
    return createPortal(
      <>
        <div className="backdrop" style={{ zIndex: z - 1 }} aria-hidden="true" onClick={onClose} />
        <div
          ref={ref}
          className="drawer"
          style={{ zIndex: z }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          {...labelled}
        >
          <div className="drawer-head">
            {head ?? (
              <h2 className="drawer-title" id={titleId}>
                {title}
              </h2>
            )}
            <span className="grow" />
            {headActions}
            {closeBtn}
          </div>
          <div className="drawer-body">{children}</div>
          {foot && <div className="drawer-foot">{foot}</div>}
        </div>
      </>,
      document.body,
    );
  return createPortal(
    <>
      <div className="backdrop" style={{ zIndex: z - 1 }} aria-hidden="true" />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking outside the card closes it (pointer only); Esc is the keyboard path */}
      <div
        className="modal"
        style={{ zIndex: z }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is dialog or alertdialog, both modal */}
        <div
          ref={ref}
          className={`modal-card${wide ? " wide" : ""}`}
          role={alert ? "alertdialog" : "dialog"}
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <div className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <span className="grow" />
            {headActions}
            {closeBtn}
          </div>
          <div className="modal-body">{children}</div>
          {foot && <div className="modal-foot">{foot}</div>}
        </div>
      </div>
    </>,
    document.body,
  );
}
/** Confirmation (alertdialog). Destructive actions write the consequence and use btn-danger. */
export function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: () => void }) {
  return (
    <Overlay
      alert
      title={options.title}
      onClose={onClose}
      initialFocus={options.danger ? "cancel" : "first"}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={`btn ${options.danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => {
              onClose();
              options.action();
            }}
          >
            {options.label ?? "Confirmar"}
          </button>
        </>
      }
    >
      <p>{options.message}</p>
    </Overlay>
  );
}

/* ==========================================================================
   Menu (padrão APG Menu Button)
   ========================================================================== */
export type MenuItem = {
  label: string;
  icon?: string;
  sub?: string;
  /** With `radio`, a single-choice item (menuitemradio); otherwise a menuitemcheckbox. */
  checked?: boolean;
  radio?: boolean;
  danger?: boolean;
  disabled?: boolean;
  node?: ReactNode;
  onClick: () => void;
};
/** "sep" draws a separator; any other string is a group heading. */
export type MenuEntry = MenuItem | string;
export function MenuButton({
  label,
  children,
  items,
  className = "btn btn-ghost btn-icon btn-sm",
  tip,
  menuLabel,
  disabled,
  id,
}: {
  /** Accessible name of the trigger (required for icon-only buttons). */
  label?: string;
  children: ReactNode;
  items: MenuEntry[] | (() => MenuEntry[]);
  className?: string;
  tip?: string;
  menuLabel?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        className={className}
        aria-label={label}
        data-tip={tip}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children}
      </button>
      {open && btn.current && (
        <Menu
          id={menuId}
          anchor={btn.current}
          label={menuLabel ?? label ?? btn.current.textContent?.trim() ?? "Menu"}
          items={typeof items === "function" ? items() : items}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
export function Menu({
  id,
  anchor,
  label,
  items,
  onClose,
}: {
  id?: string;
  anchor: HTMLElement;
  label: string;
  items: MenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef(true);
  const typed = useRef({ text: "", at: 0 });
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const list = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(".menu-item") ?? []);
  useLayer("menu", ref, onClose, {
    restore,
    trigger: anchor,
    onKey: (e) => {
      const els = list();
      const i = els.indexOf(document.activeElement as HTMLButtonElement);
      const go = (j: number) => {
        if (els.length) els[(j + els.length) % els.length]?.focus();
      };
      if (e.key === "ArrowDown") {
        e.preventDefault();
        go(i + 1);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        go(i < 0 ? -1 : i - 1);
        return true;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        go(e.key === "Home" ? 0 : -1);
        return true;
      }
      if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = typed.current;
        t.text = Date.now() - t.at > 600 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
        t.at = Date.now();
        const start = t.text.length === 1 ? i + 1 : Math.max(i, 0);
        for (let k = 0; k < els.length; k++) {
          const cand = els[(start + k) % els.length];
          if (cand?.textContent?.trim().toLowerCase().startsWith(t.text)) {
            cand.focus();
            break;
          }
        }
        return true;
      }
      return false;
    },
  });
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const r = anchor.getBoundingClientRect();
    const x = Math.min(r.left, window.innerWidth - m.offsetWidth - 8);
    let y = r.bottom + 6;
    if (y + m.offsetHeight > window.innerHeight - 8) y = Math.max(8, r.top - m.offsetHeight - 6);
    setPos({ left: Math.max(8, x), top: y });
    (m.querySelector<HTMLButtonElement>(".menu-item:not([aria-disabled=true])") ?? m).focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        restore.current = false;
        onClose();
      }
    };
    document.addEventListener("mousedown", outside, true);
    return () => document.removeEventListener("mousedown", outside, true);
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={ref}
      id={id}
      className="menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={pos ?? { visibility: "hidden", left: 0, top: 0 }}
    >
      {items.map((it, index) =>
        typeof it === "string" ? (
          it === "sep" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
            <div className="menu-sep" aria-hidden="true" key={`sep-${index}`} />
          ) : (
            <div key={`head-${it}`} className="menu-head" role="presentation">
              {it}
            </div>
          )
        ) : (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is menuitemradio/menuitemcheckbox whenever aria-checked is set
          <button
            type="button"
            // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat across groups
            key={`${it.label}-${index}`}
            role={it.radio ? "menuitemradio" : it.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
            aria-checked={it.radio || it.checked !== undefined ? !!it.checked : undefined}
            aria-disabled={it.disabled || undefined}
            tabIndex={-1}
            className={`menu-item${it.danger ? " danger" : ""}`}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onClick();
            }}
          >
            {it.icon && <Icon name={it.icon} size={15} />}
            {it.node}
            <span className="grow">
              {it.label}
              {it.sub && <span className="mi-sub">{it.sub}</span>}
            </span>
            {it.checked && <Icon name="check" size={14} />}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/* ==========================================================================
   Inspector: botão de propriedade e valor somente leitura
   ========================================================================== */
export type PropOption = { value: string; label: string; node?: ReactNode };
export function PropButton({
  label,
  value,
  options,
  onChange,
  empty = "—",
  icon,
  disabled,
}: {
  label: string;
  value: string | null | undefined;
  options: PropOption[];
  onChange: (value: string) => void;
  empty?: string;
  icon?: string;
  disabled?: boolean;
}) {
  const cur = options.find((o) => o.value === (value ?? ""));
  const isEmpty = !cur || !value;
  if (disabled) return <PropValue node={cur?.node} text={cur && value ? cur.label : empty} empty={isEmpty} />;
  return (
    <MenuButton
      className={`prop-btn${isEmpty ? " is-empty" : ""}`}
      label={`${label}: ${cur && value ? cur.label : empty}`}
      menuLabel={label}
      items={() => [
        label,
        ...options.map((o) => ({
          label: o.label,
          node: o.node,
          radio: true,
          checked: o.value === (value ?? ""),
          onClick: () => {
            if (o.value !== (value ?? "")) onChange(o.value);
          },
        })),
      ]}
    >
      {cur?.node ?? (icon ? <Icon name={icon} size={14} /> : null)}
      <span className="pv">{cur && value ? cur.label : empty}</span>
      <span className="chev" aria-hidden="true">
        <Icon name="chevD" size={12} />
      </span>
    </MenuButton>
  );
}
export function PropValue({ node, text, empty }: { node?: ReactNode; text: string; empty?: boolean }) {
  return (
    <span className={`prop-val${empty ? " is-empty" : ""}`}>
      {node}
      <span className="pv">{text}</span>
    </span>
  );
}

/* ==========================================================================
   Página, abas, vazio
   ========================================================================== */
export function PageHead({
  title,
  sub,
  children,
  aside,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** Actions on the right (.page-actions). */
  children?: ReactNode;
  /** Control next to the title, outside the h1 (project switcher). */
  aside?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {aside ? (
          <div className="page-title-row">
            <h1 tabIndex={-1}>{title}</h1>
            {aside}
          </div>
        ) : (
          <h1 tabIndex={-1}>{title}</h1>
        )}
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
/** Local navigation that changes the route: links with aria-current. */
export function TabNav({
  label,
  items,
  active,
  base,
}: {
  label: string;
  items: { key: string; label: string; count?: number }[];
  active: string;
  base: string;
}) {
  const ref = useRef<HTMLElement>(null);
  // narrow screens: the active tab is scrolled into the visible part of the tab strip
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the active tab changes
  useEffect(() => {
    const nav = ref.current;
    const tab = nav?.querySelector<HTMLElement>("[aria-current=page]");
    if (!nav || !tab) return;
    const left = tab.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft || left + tab.offsetWidth > nav.scrollLeft + nav.clientWidth)
      nav.scrollLeft = Math.max(0, left - 16);
  }, [active]);
  return (
    <nav className="tabs" aria-label={label} ref={ref}>
      {items.map((t) => (
        <a
          key={t.key}
          className={`tab${active === t.key ? " active" : ""}`}
          href={`#${base}${t.key}`}
          aria-current={active === t.key ? "page" : undefined}
        >
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </a>
      ))}
    </nav>
  );
}
export function Empty({
  icon = "tasks",
  title,
  sub,
  children,
  inline = false,
}: {
  icon?: string;
  title: string;
  sub?: ReactNode;
  children?: ReactNode;
  inline?: boolean;
}) {
  return (
    <div className={`empty${inline ? " inline" : ""}`}>
      <div className="e-ic">
        <Icon name={icon} size={20} />
      </div>
      <b>{title}</b>
      {sub && <p>{sub}</p>}
      {children}
    </div>
  );
}
/** `what` carries its own preposition and article ("às configurações do projeto", "à Central de auditoria"). */
export function NoAccess({ what }: { what: string }) {
  const { me } = useWorkspace();
  return (
    <Empty
      icon="block"
      title="Acesso restrito"
      sub={`O perfil “${roles[me.roleId]}” não tem acesso ${what}. Troque o perfil no canto superior direito para experimentar.`}
    >
      <a className="btn" href="#/dashboard">
        Voltar ao início
      </a>
    </Empty>
  );
}

/* ==========================================================================
   Domínio: avatar, ponto, glifos de status/prioridade/tipo, etiquetas, prazo
   ========================================================================== */
export function Avatar({
  user,
  size = "",
  decorative = false,
}: {
  user?: User | null;
  size?: "" | "sm" | "lg";
  /** The name is already next to it: hide from assistive technology and skip the tooltip. */
  decorative?: boolean;
}) {
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : {
        role: "img",
        "aria-label": user?.name ?? "Sem responsável",
        "data-tip": user?.name ?? "Sem responsável",
      };
  if (!user) return <span className={`avatar none ${size}`} {...a11y} />;
  return (
    <span className={`avatar ${size}`} style={{ "--av": catVar(user.color) } as CSSProperties} {...a11y}>
      {user.initials}
    </span>
  );
}
export function Who({ id }: { id?: string | null }) {
  const { db } = useWorkspace();
  const u = db.users.find((x) => x.id === id);
  return u ? (
    <span className="who-cell">
      <Avatar user={u} size="sm" decorative />
      <span className="nm">{u.name}</span>
    </span>
  ) : (
    <span className="muted">—</span>
  );
}
export function ProjectDot({
  project,
  lg = false,
}: {
  project?: Pick<Project, "color"> | null;
  lg?: boolean;
}) {
  return (
    <span
      className={`dot${lg ? " lg" : ""}`}
      aria-hidden="true"
      style={{ "--dot": catVar(project?.color) } as CSSProperties}
    />
  );
}
export function Progress({
  value,
  label = "Progresso",
  tone,
}: {
  value: number;
  label?: string;
  tone?: "ok" | "warn" | "danger";
}) {
  const pct = Math.round(Math.min(100, Math.max(0, value)));
  const cls = tone ?? (pct === 100 ? "ok" : "");
  return (
    <div
      className={`progress${cls ? ` ${cls}` : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}%`}
    >
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
export function StatusIcon({
  status,
  size = 14,
  label = false,
}: {
  status: TaskStatus;
  size?: number;
  label?: boolean;
}) {
  const a11y = label
    ? { role: "img", "aria-label": STATUS_META[status].label }
    : { "aria-hidden": true as const };
  return (
    <span style={{ display: "inline-flex", flex: "none", color: STATUS_META[status].color }} {...a11y}>
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
const PRIO_PATHS: Record<Priority, string> = {
  urgent: "m6 11 6-5 6 5M6 17l6-5 6 5",
  high: "m6 14.5 6-5 6 5",
  medium: "M6 9.5h12M6 14.5h12",
  low: "m6 9.5 6 5 6-5",
};
export function PrioGlyph({ priority, size = 13 }: { priority: Priority; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PRIO_PATHS[priority]} />
    </svg>
  );
}
/** Priority glyph + label; `bare` shows only the glyph, named for assistive technology. */
export function PriorityChip({ priority, bare = false }: { priority: Priority; bare?: boolean }) {
  const m = PRIO_META[priority];
  return bare ? (
    <span
      className="prio"
      style={{ color: m.color }}
      data-tip={m.label}
      role="img"
      aria-label={`Prioridade ${m.label}`}
    >
      <PrioGlyph priority={priority} />
    </span>
  ) : (
    <span className="prio" style={{ color: m.color }}>
      <PrioGlyph priority={priority} />
      {m.label}
    </span>
  );
}
export function TypeIcon({
  type,
  size = 14,
  decorative = false,
}: {
  type: string;
  size?: number;
  decorative?: boolean;
}) {
  const m = TYPE_META[type as keyof typeof TYPE_META] ?? TYPE_META.task;
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : { role: "img", "aria-label": m.label, "data-tip": m.label };
  return (
    <span className="ico" style={{ display: "inline-flex", flex: "none", color: m.color }} {...a11y}>
      <Icon name={m.icon} size={size} />
    </span>
  );
}
export function LabelChip({ name }: { name: string }) {
  const cat = LABEL_META[name]?.cat;
  return (
    <span
      className="label-chip"
      style={{ "--lc": cat ? `var(--cat-${cat})` : "var(--ink-3)" } as CSSProperties}
    >
      {labelName(name)}
    </span>
  );
}
export function DueLabel({ task, lateForm = false }: { task: Task; lateForm?: boolean }) {
  if (!task.dueDate) return null;
  const tone = dueTone(task);
  return (
    <span className={`due${tone ? ` ${tone}` : ""}`}>
      <Icon name="calendar" size={12} />
      {dueText(task, lateForm)}
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
  const [c, label] = m[p.archived ? "archived" : p.status] ?? ["accent", "Ativo"];
  return <span className={`chip ${c}`}>{label}</span>;
}
export function Risk({ p }: { p: Project }) {
  const { db } = useWorkspace();
  const risk = projectRisk(db, p);
  const tone = risk.level === "high" ? "danger" : risk.level === "mid" ? "warn" : "ok";
  return <span className={`chip ${tone}`}>{risk.label}</span>;
}

/* ==========================================================================
   Listas: linha de tarefa e linha do tempo
   ========================================================================== */
/** ListRow of a task: status + type · title and "REF · project" · late chip, due, priority, avatar. */
export function TaskRow({ task, showProject = true }: { task: Task; showProject?: boolean }) {
  const { db } = useWorkspace();
  const ui = useUI();
  const p = db.projects.find((x) => x.id === task.projectId);
  const u = db.users.find((x) => x.id === task.assigneeId);
  return (
    <button
      type="button"
      className="list-item"
      aria-current={ui.openTaskId === task.id || undefined}
      onClick={() => ui.openTask(task.id)}
    >
      <span className="li-lead">
        <StatusIcon status={task.status} label />
        <TypeIcon type={task.type} />
      </span>
      <span className="li-main">
        <span className="li-title">{task.title}</span>
        <span className="li-meta">
          <span className="mono">{task.ref}</span>
          {showProject && p && (
            <>
              <span className="sepd" />
              {p.name}
            </>
          )}
        </span>
      </span>
      <span className="li-trail">
        {isOverdue(task) && <span className="chip danger">Atrasada</span>}
        <DueLabel task={task} />
        <PriorityChip priority={task.priority} bare />
        <Avatar user={u} size="sm" />
      </span>
    </button>
  );
}
/** Activity timeline: avatar on the rail, who + what, when. */
export function ActivityFeed({
  entries,
}: {
  entries: { id: string; userId: string; summary: string; ts: string }[];
}) {
  const { db } = useWorkspace();
  return (
    <div className="timeline">
      {entries.map((a) => {
        const u = db.users.find((x) => x.id === a.userId);
        return (
          <div className="hist-item" key={a.id}>
            <Avatar user={u} size="sm" decorative />
            <span className="tl-txt">
              <b>{u?.name ?? "?"}</b> {a.summary}
            </span>
            <time dateTime={a.ts}>{rel(a.ts)}</time>
          </div>
        );
      })}
    </div>
  );
}

/* ==========================================================================
   Controles: select, filtro rotulado, segmentado, switch, campo
   ========================================================================== */
export type Option = { value: string; label: string };
export function Select({
  value,
  onChange,
  options,
  label,
  disabled,
  style,
  id,
  className = "select",
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  label?: string;
  disabled?: boolean;
  style?: CSSProperties;
  id?: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      className={className}
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
/** Filter with a visible label; active (`.is-set`) when the value differs from `def`. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  def = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  def?: string;
}) {
  return (
    <label className={`fsel${value !== def ? " is-set" : ""}`}>
      <span className="fsel-l" aria-hidden="true">
        {label}
      </span>
      <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
/** Segmented control as a radiogroup (arrow keys move the choice). */
export function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
}) {
  const move = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next =
      options[
        (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
      ];
    if (!next) return;
    const group = e.currentTarget;
    onChange(next.value);
    requestAnimationFrame(() =>
      group.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus(),
    );
  };
  return (
    <div className="seg" role="radiogroup" aria-label={label} onKeyDown={move}>
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: radio inside the APG radiogroup above
        <button
          key={o.value}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="tr" />
    </span>
  );
}
type ControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
};
/**
 * Label above, control, hint and error below. The label is bound with for/id and the hint
 * and error with aria-describedby; pass a single control element (or a render function).
 */
export function Field({
  label,
  hint,
  wide = false,
  error,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  error?: string | null;
  required?: boolean;
  children: ReactElement<ControlProps> | ((props: ControlProps) => ReactNode);
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const described = [hint ? hintId : "", error ? errId : ""].filter(Boolean).join(" ") || undefined;
  const props: ControlProps = {
    id,
    "aria-describedby": described,
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(required ? { "aria-required": true as const } : {}),
  };
  const control =
    typeof children === "function"
      ? children(props)
      : isValidElement(children)
        ? cloneElement(children, props)
        : children;
  return (
    <div className={`field${wide ? " span2" : ""}${error ? " invalid" : ""}${required ? " required" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="err" id={errId}>
          <Icon name="alert" size={12} />
          {error}
        </span>
      )}
    </div>
  );
}
/** Group of checkboxes or chip toggles with an accessible name. */
export function FieldGroup({
  label,
  children,
  wide = false,
  error,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  error?: string | null;
}) {
  const id = useId();
  return (
    <fieldset
      className={`field${wide ? " span2" : ""}${error ? " invalid" : ""}`}
      aria-describedby={error ? `${id}-err` : undefined}
    >
      <legend>{label}</legend>
      {children}
      {error && (
        <span className="err" id={`${id}-err`}>
          <Icon name="alert" size={12} />
          {error}
        </span>
      )}
    </fieldset>
  );
}

/* ==========================================================================
   KPI e sparkline
   ========================================================================== */
/** Sparkline of a real series (decorative: the number next to it carries the information). */
export function Sparkline({ values }: { values: number[] }) {
  const W = 88;
  const H = 28;
  const pad = 3;
  const n = values.length;
  if (!n) return null;
  const max = Math.max(1, ...values);
  const x = (i: number) => pad + (n < 2 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (n - 1));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <path
        className="sp-area"
        d={`${d} L${x(n - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`}
      />
      <path className="sp-line" d={d} />
      <circle className="sp-dot" r="2.5" cx={x(n - 1).toFixed(1)} cy={y(values[n - 1] ?? 0).toFixed(1)} />
    </svg>
  );
}
export function Stat({
  icon,
  label,
  value,
  ctx,
  tone,
  spark,
  delta,
  href,
}: {
  icon: string;
  label: string;
  value: ReactNode;
  ctx?: ReactNode;
  /** Only when the number describes a state. */
  tone?: "bad" | "good";
  spark?: number[];
  /** Comparison with the previous period (neutral color). */
  delta?: { value: number; label: string };
  href?: string;
}) {
  const body = (
    <>
      <span className="lbl">
        <Icon name={icon} size={14} />
        {label}
      </span>
      <span className="stat-row">
        <span className="val">{value}</span>
        {spark && <Sparkline values={spark} />}
      </span>
      {(ctx || delta) && (
        <span className={`ctx${tone ? ` ${tone}` : ""}`}>
          {delta && (
            <span className="delta">
              <Icon name={delta.value < 0 ? "trendDown" : "trendUp"} size={12} />
              {delta.value > 0 ? "+" : ""}
              {delta.value}
            </span>
          )}
          {delta ? delta.label : ctx}
        </span>
      )}
      {href && (
        <span className="go" aria-hidden="true">
          <Icon name="arrowR" size={14} />
        </span>
      )}
    </>
  );
  return href ? (
    <a className="stat" href={href}>
      {body}
    </a>
  ) : (
    <div className="stat">{body}</div>
  );
}

/* ==========================================================================
   Avisos (toasts)
   ========================================================================== */
const TOAST_ICON: Record<Toast["tone"], string> = { ok: "check", err: "block", warn: "alert", info: "info" };
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismiss = useRef(() => {});
  dismiss.current = () => {
    clearTimeout(timer.current);
    if (ref.current?.contains(document.activeElement)) focusFallback();
    setLeaving(true);
    setTimeout(() => onDismiss(toast.id), 200);
  };
  // errors stay until closed; other tones leave after 4.2 s (paused on hover or focus)
  const arm = useRef(() => {});
  arm.current = () => {
    clearTimeout(timer.current);
    if (toast.tone !== "err") timer.current = setTimeout(() => dismiss.current(), 4200);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: a repeated toast (count) re-arms the timer
  useEffect(() => {
    announce(`${toast.title}${toast.message ? `. ${toast.message}` : ""}`, toast.tone === "err");
    arm.current();
    return () => clearTimeout(timer.current);
  }, [toast.count]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only pause the auto-dismiss timer
    <div
      ref={ref}
      className={`toast ${toast.tone}${leaving ? " leaving" : ""}`}
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={() => {
        if (!ref.current?.contains(document.activeElement)) arm.current();
      }}
      onFocus={() => clearTimeout(timer.current)}
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) arm.current();
      }}
    >
      <span className="t-ic" aria-hidden="true">
        <Icon name={TOAST_ICON[toast.tone]} size={16} />
      </span>
      <div className="grow">
        <b>
          {toast.title}
          {toast.count > 1 && <small className="t-count"> ({toast.count}×)</small>}
        </b>
        {toast.message && <span>{toast.message}</span>}
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm toast-close"
        aria-label={`Fechar aviso: ${toast.title}`}
        onClick={() => dismiss.current()}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
export function Toasts() {
  const { toasts, act } = useWorkspace();
  return (
    <div id="toasts">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={act.dismissToast} />
      ))}
    </div>
  );
}
