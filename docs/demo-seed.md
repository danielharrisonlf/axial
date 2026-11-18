# Seed de demonstração (Vetor Labs)

O backend recebe o mesmo cenário fictício que o Workspace mostra: a organização **Vetor Labs** e a segunda organização **Atlas Engenharia & Consultoria**, com 18 pessoas, 7 equipes, 11 projetos, 14 épicos, 7 sprints, 10 marcos, 109 tarefas (refs como `PCL-109`), comentários e a trilha de auditoria. Assim, Workspace (quando passar a usar a API), MCP e assistente enxergam os mesmos projetos e tarefas. Todos os dados são fictícios e servem só a desenvolvimento e demonstração.

## Fonte única: `packages/demo-fixtures`

- `src/demo-seed.json` é uma cópia de `apps/web/src/data/demo-seed.json` (o web continua usando a dele). Ao mudar o cenário, mude as duas.
- `demoId(legacyId)` gera um UUID versão 5 determinístico (SHA-1 do namespace fixo `DEMO_NAMESPACE` + id do protótipo, como `u1`, `prj-pcl`, `tsk12`). Todo serviço chega ao mesmo id a partir do mesmo id legado, sem consultar outro schema.
- `shift(now, timeZone)` reproduz `createDemoData(now)` de `apps/web/src/data/seed.ts`: datas sem hora andam dias inteiros (no fuso), instantes mantêm a distância até `now` e nada fica no futuro.
- `localDay(ymd, timeZone = "America/Sao_Paulo", edge)` converte uma data sem hora em datetime ISO com offset: início do dia local, ou fim (`23:59:59.999`) para prazos, fim de sprint, fim de projeto e marcos.
- `buildDemoFixtures({ now, timeZone })` devolve o cenário no formato do backend: `organizations`, `roles`, `users`, `teams`, `memberships`, `teamMemberships`, `projectAssignments`, `projects`, `epics`, `sprints`, `milestones`, `tasks`, `comments`, `auditEvents` e `excluded`.
- As partes que não dependem de data também são exportadas como constantes (`organizations`, `users`, `teams`, `memberships`, `teamMemberships`, `projectAssignments`, `VETOR_ORGANIZATION_ID`), além de `demoUser(email)` e `claimsFor(userId)`, que calcula as claims com as mesmas regras do `claims` do ms-identity.
- `validateFixtures`/`assertValidFixtures` conferem o cenário contra os schemas de `@axial/contracts` e as invariantes do ms-projects que o seed contorna ao gravar linhas diretamente: referências dentro da organização e do projeto, equipe da tarefa pertencente ao projeto, no máximo uma sprint ativa por projeto, um nível de subtarefa, subtarefa aberta só sob pai aberto, dependências acíclicas, refs únicas e `taskSequence` igual ao último número.

Mapeamentos:

| Protótipo | Backend |
|---|---|
| papel `admin`, `pm`, `lead`, `dev`, `viewer` | `ADMIN`, `PROJECT_MANAGER`, `TEAM_LEAD`, `CONTRIBUTOR`, `VIEWER` |
| épico `active` / `done` | `in_progress` / `done` |
| tarefa `done` | `completedAt` = última atualização (mesma regra da migração 8 → 9 do web) |
| sprint `active`/`done` | `startedAt` = instante do evento `sprint_start` da auditoria (ou início do dia de início); `completedAt` = fim do dia de término |
| marco `done` | `completedAt` = fim do dia do marco |
| `acceptance` | `acceptanceCriteria` como `[{ text, done }]` |
| auditoria `create`/`status`/`assign`/`sprint_start` | `project.created`, `task.created`, `task.status_changed` ou `task.completed` (quando o novo status é `done`, como no serviço), `task.assigned`, `sprint.started` |

Atribuições a projetos (`projectAssignments`): o líder do projeto; gestores (PM) e líderes de equipe de cada equipe do projeto, além do líder da equipe; e todo `VIEWER` da organização (Sérgio Tavares) em todos os projetos dela.

Registros deixados de fora, listados em `excluded`: entradas de auditoria que o backend não registra (tentativas negadas, notificações, administração de usuários; não há nenhuma no cenário atual) e dois registros do protótipo que cruzam organizações e que nenhum serviço aceitaria: o comentário `cm12` (autor da Atlas em tarefa da Vetor) e a entrada `au69` (gestor da Vetor atribuindo tarefa da Atlas). O resultado: 33 comentários e 74 eventos de auditoria.

## Ordem e comandos

A ordem é **identity → projects → audit**. Cada passo escreve apenas o próprio schema, só insere (ids determinísticos; nada é atualizado nem apagado), recusa `NODE_ENV=production` e exige banco com sufixo `_dev`.

```powershell
pnpm db:migrate
pnpm db:audit:migrate
pnpm --filter "@axial/demo-fixtures..." build
pnpm db:seed:demo        # projects e depois audit (scripts/seed-demo.mjs)
```

- `pnpm db:seed` roda só o seed do ms-projects; `pnpm db:audit:seed`, só o do ms-audit.
- Entradas de teste: `pnpm --filter @axial/ms-projects db:seed:test` (usa `TEST_DATABASE_URL`) e `pnpm --filter @axial/ms-audit db:seed:test` (usa `AUDIT_TEST_DATABASE_URL`); ambas aceitam somente bancos `_test`.
- As datas são calculadas no momento da primeira execução. Repetir o seed depois não move nada: as linhas já existem e são preservadas. Para datas atuais, recrie um banco de desenvolvimento descartável.
- O seed do identity ainda não existe; o gancho está marcado com `TODO(identity)` em `scripts/seed-demo.mjs` e `deploy/setup.sh`.
- Em deploy, `deploy/setup.sh` roda os seeds de projects e audit quando `AXIAL_SEED=true` (padrão).

## ms-projects

`apps/api/prisma/demo-seed.ts` grava uma transação por projeto com `createMany({ skipDuplicates: true })`, preservando `createdAt`, `updatedAt`, `completedAt`, refs e números (o número é o sufixo da ref). `taskSequence` recebe o maior número, então a próxima tarefa criada pela API continua a sequência (`PCL-120`). Se a chave do projeto já pertencer a outro id na organização, o seed para com erro; depois de gravar, confere que cada linha do cenário existe com o próprio id (um `skipDuplicates` causado por outra chave única aborta a transação do projeto).

**Sem eventos de outbox.** O histórico do cenário vai para o ms-audit pelo seed dele. Publicar o seed pelo outbox duplicaria a auditoria e dispararia atualizações em tempo real e notificações de coisas que não aconteceram. A versão das linhas semeadas é 1; as versões dos agregados nos eventos de auditoria refletem a ordem do histórico, não a coluna `version`.

O projeto `AXL` do seed anterior não é mais criado nem é removido: se existir em um banco antigo, continua lá, na organização `aaaaaaaa-…`.

## ms-audit

`apps/ms-audit/src/seed-demo.ts` valida cada evento com `domainEventEnvelopeSchema` (o mesmo contrato do consumidor) e insere em `audit.events` com `ON CONFLICT (id) DO NOTHING`. `actor_source` vem da origem do protótipo (`ui`, `mcp`, `automation`), `correlation_id` é `demo-seed-<id legado>` e `data` traz `before`/`after` do protótipo com ids remapeados.

## Tokens de desenvolvimento

`node scripts/dev-identity.mjs token <PAPEL>` assina como uma pessoa semeada da Vetor Labs, com as claims de `claimsFor` (equipes, projetos atribuídos, pessoas e equipes atribuíveis):

| Papel | Pessoa |
|---|---|
| `ADMIN` | Helena Costa |
| `PROJECT_MANAGER` | Ricardo Nogueira |
| `TEAM_LEAD` | Ana Souza (Plataforma) |
| `CONTRIBUTOR` | Camila Freitas |
| `VIEWER` | Sérgio Tavares |

O comando lê `packages/demo-fixtures/dist`; compile o pacote antes (`pnpm --filter "@axial/demo-fixtures..." build`).

## O que o seed do identity precisa fazer

Para casar com os ids dos outros schemas, o seed do ms-identity deve usar `@axial/demo-fixtures` e gravar, só no schema `identity`:

- `organizations` com `id` de `organizations[].id` (nome do protótipo);
- usuários com `id = users[].id` e o e-mail do cenário (tabelas de usuário do BetterAuth incluídas; senhas de demonstração continuam sendo fixtures de desenvolvimento);
- `members` a partir de `memberships` (papel já mapeado);
- `teams` e `team_members` a partir de `teams` e `teamMemberships`;
- `project_assignments` a partir de `projectAssignments`.

Com isso, as claims emitidas pelo ms-identity ficam iguais às de `claimsFor` e às dos tokens de desenvolvimento.
