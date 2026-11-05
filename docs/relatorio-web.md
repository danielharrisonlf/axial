# Relatório - Workspace React e estrutura api/web

Data: 05/11/2026. Solicitação: organizar apps/api e apps/web e iniciar a interface ms-projects em React com Vite, fiel ao protótipo.

## Entrega

- Backend movido de apps/ms-projects para **apps/api**, preservando pacote @axial/ms-projects, schema projects e contratos. Os 37 arquivos do serviço foram conferidos com normalização de fins de linha; o Dockerfile foi adaptado à nova estrutura.
- **apps/web** criado com React 19.2.8, Vite 8.3.4, plugin React compatível, TypeScript estrito e scripts integrados ao monorepo pnpm/Turbo.
- Shell, navegação, projetos/lista/detalhe, abas, tarefas, dashboard, Kanban, backlog, sprints e cronograma em JSX. Não há iframe nem execução do renderizador legado.
- Modais, drawer, filtros, favoritos, comentários, critérios, subtarefas, dependências, drag-and-drop, perfis, tema e persistência local funcionando.
- Stylesheet original e paths SVG autorais reutilizados, com IBM Plex e dimensões da referência. Marca atualizada para Axial.
- Estado fictício separado do protótipo, com recuperação de dados inválidos e aviso quando persistência não está disponível.
- README, arquitetura, AGENTS, comandos, Dockerfile e CI atualizados para api/web. Pipeline inclui testes reais no Chromium e artifacts em caso de falha.

## Verificação local

| Check | Resultado |
| --- | --- |
| pnpm lint | 69 arquivos, aprovado sem erros/avisos |
| pnpm typecheck | Três pacotes aprovados |
| pnpm build | API, contratos e web aprovados |
| Unidade frontend | **13/13** |
| Aceitação frontend Chromium | **8/8**, sem retries/skips/pageerrors |
| Contratos compartilhados | **9/9** |
| Unidade da API após mudança de pasta | **3/3** |
| Integração PostgreSQL/Redis da API | **3/3** |
| E2E HTTP da API | **13/13** |
| Total | **49 testes aprovados** |
| Imagem API com nova estrutura | Build Linux aprovado |
| Revisão independente | Aceita; achados materiais corrigidos e revalidados |

Imagem API validada após reorganização: sha256:f60422eec8e2f82398287753d522f15ebf1c154f2c0448a2c4f52db499921b71. A validação visual está em [design-qa.md](../design-qa.md), com referências e screenshots versionados.

## Limites explícitos

A interface nesta entrega é uma **demonstração local interativa**, com os mesmos 11 projetos e 109 tarefas fictícias do protótipo. Suas mutações ainda não usam a API; não há fallback silencioso que esconda falhas de integração. A conexão real dependerá da sessão de identidade e do mapeamento dos contratos documentados em frontend.md.

Não foram implementados novos serviços de identidade, notificações, auditoria, tempo real, MCP ou Insights Vue. O backend existente mantém suas garantias e testes.

Toda delegação desta etapa usou GPT-6.1 Sol com raciocínio high. Semantica não estava disponível; as decisões e evidências ficaram nos documentos versionados.

## Uso

```powershell
pnpm dev:web
```

Interface em http://localhost:5173. `pnpm dev:api` inicia somente o backend; `pnpm dev` inicia os dois. A estrutura final em apps contém as pastas api e web.
