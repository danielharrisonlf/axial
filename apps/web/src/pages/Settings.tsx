import { PageHead, Segmented } from "../components/ui";
import type { Theme } from "../data/types";
import { useWorkspace } from "../data/workspace";

/** Configurações: aparência da interface. */
export function Settings() {
  const { db, act } = useWorkspace();
  return (
    <>
      <PageHead title="Configurações" sub="Aparência da interface." />
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
    </>
  );
}
