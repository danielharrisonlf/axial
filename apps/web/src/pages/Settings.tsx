import { Icon } from "../components/Icon";
import { PageHead, Segmented, TabNav, useUI } from "../components/ui";
import type { Theme } from "../data/types";
import { useWorkspace } from "../data/workspace";

/** Configurações: aparência e dados desta demonstração (sem a aba de arquitetura nem o cartão da organização). */
export function Settings({ tab }: { tab?: string }) {
  const { db, act, can } = useWorkspace();
  const ui = useUI();
  const current = tab === "data" ? "data" : "general";
  return (
    <>
      <PageHead
        title="Configurações"
        sub="Aparência da interface e dados desta demonstração: restaurar o cenário inicial ou exportar o estado."
      />
      <TabNav
        label="Seções de configurações"
        items={[
          { key: "general", label: "Aparência" },
          { key: "data", label: "Dados da demonstração" },
        ]}
        active={current}
        base="/settings/"
      />
      {current === "general" ? (
        <div className="stack narrow">
          <div className="panel">
            <div className="panel-head">
              <h2>Aparência</h2>
            </div>
            <div className="panel-body">
              <div className="field">
                <span className="fl" aria-hidden="true">
                  Tema da interface
                </span>
                <Segmented
                  label="Tema da interface"
                  value={db.settings.theme}
                  onChange={(v) => act.setTheme(v as Theme)}
                  options={[
                    { value: "light", label: "Claro" },
                    { value: "dark", label: "Escuro" },
                    { value: "system", label: "Sistema" },
                  ]}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel narrow">
          <div className="panel-head">
            <h2>Persistência local</h2>
          </div>
          <div className="panel-body">
            <p className="muted">
              As alterações ficam salvas neste navegador e sobrevivem ao recarregamento da página.
            </p>
            <div className="btn-row">
              {can("user.manage") ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() =>
                    ui.confirm({
                      title: "Restaurar dados de demonstração",
                      message: "Todas as alterações feitas serão descartadas e o cenário inicial volta.",
                      label: "Restaurar",
                      danger: true,
                      action: act.resetDemo,
                    })
                  }
                >
                  <Icon name="refresh" size={14} />
                  Restaurar dados de demonstração
                </button>
              ) : (
                <p className="ro-note">
                  <Icon name="block" size={12} />
                  Só o perfil Administrador pode restaurar os dados. Troque o perfil no canto superior
                  direito.
                </p>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = "axial-demo.json";
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                <Icon name="download" size={14} />
                Exportar estado (JSON)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
