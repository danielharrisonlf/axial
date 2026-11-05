# Relatório de implementação - Axial / ms-projects

Data: 05/11/2026. Escopo: monorepo Axial e serviço de projetos, conforme apresentação definitiva fornecida pelo usuário. Repositório: [danielharrisonlf/axial](https://github.com/danielharrisonlf/axial), privado.

Este relatório registra a entrega inicial do backend. Na etapa seguinte, a API foi movida para apps/api e a interface React/Vite foi criada em apps/web; veja o [relatório dessa etapa](relatorio-web.md). Os limites de frontend citados abaixo se referem ao escopo inicial.

## Resultado

Foi criado um monorepo independente do protótipo, com apenas um serviço executável: `apps/api`. Não houve alteração do código do protótipo, da landing page ou dos repositórios usados como referência.

A API possui **39 operações documentadas** (incluindo duas de saúde), persistência real no PostgreSQL e publicação BullMQ em três filas. A implementação cobre planejamento, execução e projeções dos dados de projetos; consumidores e aplicações futuras permanecem separados.

## O que foi entregue

| Área | Implementação |
| --- | --- |
| Monorepo | pnpm 10.11.1, Turborepo, apps/packages, catálogo e lockfile único |
| Serviço | NestJS 12 ESM, TypeScript estrito, injeção explícita, configuração validada |
| Contratos | Pacote @axial/contracts com Zod, tipos de identidade, eventos e entradas HTTP |
| Banco | Prisma 7, adapter PostgreSQL, schema projects e migration inicial versionada |
| Projetos | Criação/listagem/detalhe/edição, chave imutável, filtros, arquivo e restauração |
| Planejamento | Épicos, sprints, marcos e cronograma |
| Trabalho | Tarefas, bugs, subtarefas, prioridades, responsáveis, equipes, critérios, labels e estimativas |
| Kanban | Colunas por status, movimentação, posição, filtros e paginação |
| Dependências | Bloqueadores, validação de referências e ciclos explícitos/implícitos |
| Comentários | Autoria, leitura, criação e edição/exclusão com autorização |
| Indicadores | Progresso, atrasos e pontos estimados/concluídos sem dupla contagem de subtarefas |
| Acesso | JWT RS256, tenant, escopo de projetos/equipes e cinco papéis |
| Concorrência | Versão obrigatória, bloqueio por projeto, sequência atômica e sprint ativa única |
| Eventos | Outbox na mesma transação; relay com lease, retry e fanout nas três filas |
| Operação | Liveness/readiness, shutdown, logs estruturados, correlação e erros redigidos |
| Desenvolvimento | Compose PostgreSQL/Redis, seed idempotente e emissor de tokens exclusivamente local |
| Documentação | Requisitos, arquitetura, identidade/API/eventos, operação e OpenAPI versionado |
| Automação | Workflow GitHub Actions com lint, tipos, build, migrations e testes reais |
| Imagem | Build Linux validado e execução com usuário não root |

## Decisões relevantes

1. **O PDF final prevalece sobre o protótipo:** cinco microsserviços, PostgreSQL por schema e BullMQ/Redis. Não foi implementada a arquitetura anterior SNS/SQS nem um assistente interno de IA.
2. **Identidade fica fora de projects:** o serviço verifica tokens e referências assinadas. Não cria usuários, equipes ou tabelas em schemas de outros serviços.
3. **Auditoria é um consumidor futuro:** before/after, ator, origem e correlação ficam no envelope durável. Não foi criada uma central de auditoria dentro do serviço de projetos.
4. **Consistência antes de paralelismo dentro do agregado:** mutações de um mesmo projeto são serializadas por bloqueio transacional e verificam versões. Projetos diferentes não usam o mesmo bloqueio.
5. **Sprints encerradas preservam histórico:** tarefas concluídas ficam associadas; inacabadas voltam ao backlog. Regras adicionais não expressas no PDF estão descritas em requirements.md.
6. **Entrega pelo menos uma vez:** jobs têm ID estável e o outbox só confirma após as três filas. Consumidores ainda precisam de deduplicação durável e tratamento de reordenação.

## Validação executada

| Verificação | Resultado observado |
| --- | --- |
| Prisma validate e geração do cliente | Aprovados |
| Migrations em bancos vazios axial_dev e axial_test | Aplicadas com sucesso |
| pnpm lint | Aprovado, sem erros ou avisos |
| pnpm typecheck | Aprovado nos dois pacotes |
| pnpm build | Aprovado nos dois pacotes |
| Contratos unitários | 9 testes aprovados |
| Unidade do serviço/configuração | 3 testes aprovados |
| Integração PostgreSQL/Redis | 3 testes aprovados |
| E2E HTTP com PostgreSQL | 13 testes aprovados |
| Total automatizado | **28 testes aprovados, nenhum ignorado** |
| GitHub Actions em Ubuntu/Linux | **Aprovado** no commit de implementação 6d2ee6a; [execução CI 41969258030](https://github.com/danielharrisonlf/axial/actions/runs/41969258030) |
| Auditoria de dependências de produção | Nenhuma vulnerabilidade conhecida reportada pelo pnpm audit no momento da execução |
| Build Docker Linux do candidato final | Aprovado |
| Runtime em produção no contêiner | Liveness/readiness 200; sem token 401; leitura autenticada 200; Swagger 404 |
| Usuário do contêiner | UID 1000 |
| Relay real na demonstração | 6 de 6 eventos publicados; 6 jobs em cada uma das três filas |
| Verificação de padrões de credenciais nos fontes | Nenhuma chave privada/token encontrado |
| Validação da skill de orquestração atualizada | quick_validate: Skill is valid |

Os testes de banco usaram exclusivamente `axial_test`, e as filas de teste usaram o banco lógico Redis 15. O contêiner de aceitação foi parado e removido após o smoke test; dados e serviços de desenvolvimento foram preservados.

Imagem validada: `sha256:845885257c28c704d1cc2841d99dbfc21d8b289f2517bee3aa458ff1657517b9`.

A execução remota confirmou instalação por lockfile, geração Prisma, migration em banco vazio, lint, typecheck, build e todas as suítes. O código aceito está no commit `6d2ee6a00ca9be72d9e0499c54a1fd59178457f3`; a atualização posterior deste relatório altera apenas documentação e preserva esse candidato.

## Falhas encontradas e corrigidas

- **PATCH com defaults indevidos:** Zod aplicava padrões de criação em campos omitidos, podendo sobrescrever dados e impedir contributor de editar sua própria tarefa. Os schemas parciais removem os defaults; regressões de contrato e HTTP passaram.
- **Ciclo entre pai e subtarefa:** o grafo só de bloqueadores não representava a condição de concluir subtarefas antes do pai. A validação passou a considerar essas arestas implícitas, inclusive na criação de filhos e em cadeias indiretas.
- **Inicialização com dependência transitiva:** o bootstrap importava Express sem declará-lo diretamente. Foi substituído pelo método público useBodyParser do adapter NestJS.
- **Erros do parser:** JSON malformado e excesso de tamanho têm respostas 400/413 redigidas e cenários de regressão.
- **Qualidade e compatibilidade:** middleware usa wildcard compatível com a versão atual e a configuração Biome foi migrada para o preset vigente.

## Agentes, skills e modelo

Foram usadas as skills PDF, Vitest, skill-creator e orquestração. Após a orientação do usuário, implementação, validação e revisão passaram a usar exclusivamente **GPT-6.1 Sol com raciocínio high**. O agente de testes incompatível foi interrompido e substituído; seus arquivos foram preservados e revalidados pelo agente Sol.

A skill global `C:/Users/daniellima/.agents/skills/astra-orchestrator/SKILL.md` foi atualizada e validada. O identificador histórico foi preservado, e sua política agora exige Sol/high em todos os papéis, sem substituição automática. AGENTS.md do Axial registra o mesmo padrão. Isso não altera retroativamente o modelo usado no planejamento anterior nem troca o modelo de uma sessão raiz já iniciada.

## Limites e próximos componentes

- Não estão implementados ms-identity, ms-notifications, ms-audit, ms-realtime, gateway, mcp-server nem frontends React/Vue.
- Jobs publicados não comprovam entrega de mensagens, sincronização WebSocket ou gravação no futuro serviço de auditoria.
- Referências de identidade são snapshots assinados; revogação imediata depende da futura integração com identidade.
- OpenAPI possui schemas de entrada e parâmetros; não oferece schemas completos de resposta para geração automática de clientes nesta etapa.
- A imagem de execução inclui ferramentas de build. Reduzir seu tamanho é uma otimização futura.
- A política de retenção/arquivo de eventos e jobs deve ser definida com os consumidores. Perda total de Redis após confirmação exige recuperação operacional a partir do outbox.
- Não houve deploy em ambiente de produção.
- Semantica não estava disponível; decisões e evidências ficaram registradas nos documentos versionados, sem alegação de persistência em memória durável externa.

## Referência verificável do escopo

SHA256 do PDF fornecido: `fb425e27798fe02228a327946943e56f36838260362eedb5475cc2a9b225fee5`. A correspondência de requisitos por página está em requirements.md; convenções e revisões dos repositórios recentes estão em architecture.md.
