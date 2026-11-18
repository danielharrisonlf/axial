# Seed de demonstração (Vetor Labs)

O backend recebe o mesmo cenário fictício que o Workspace mostra: a organização **Vetor Labs** e a segunda organização **Atlas Engenharia & Consultoria**, com 18 pessoas, 7 equipes, 11 projetos, 14 épicos, 7 sprints, 10 marcos, 109 tarefas (refs como `PCL-109`), comentários e a trilha de auditoria. Assim, Workspace (quando passar a usar a API), MCP e assistente enxergam os mesmos projetos e tarefas. Todos os dados são fictícios e servem só a desenvolvimento e demonstração.

## Fonte única: `packages/demo-fixtures`

- `src/demo-seed.json` é uma cópia de `apps/web/src/data/demo-seed.json` (o web continua usando a dele). Ao mudar o cenário, mude as duas.
- `demoId(legacyId)` gera um UUID versão 5 determinístico (SHA-1 do namespace fixo `DEMO_NAMESPACE` + id do protótipo, como `u1`, `prj-pcl`, `tsk12`). Todo serviço chega ao mesmo id a partir do mesmo id legado, sem consultar outro schema.
- `shift(now, timeZone)` reproduz `createDemoData(now)` de `apps/web/src/data/seed.ts`: datas sem hora andam dias inteiros (no fuso), instantes mantêm a distância até `now` e nada fica no futuro.
- `localDay(ymd, timeZone = "America/Sao_Paulo", edge)` converte uma data sem hora em datetime ISO com offset: início do dia local, ou fim (`23:59:59.999`) para prazos, fim de sprint, fim de projeto e marcos.
- `buildDemoFixtures({ now, timeZone })` devolve o cenário no formato do backend: `organizations`, `roles`, `users`, `teams`, `memberships`, `teamMemberships`, `projectAssignments`, `projects`, `epics`, `sprints`, `milestones`, `tasks`, `comments`, `auditEvents` e `excluded`.
- As partes que não dependem de data também são exportadas como constantes (`organizations`, `users`, `teams`, `memberships`, `teamMemberships`, `projectAssignments`, `VETOR_ORGANIZATION_ID`), além de `demoUser(email)` e `claimsFor(userId, organizationId?)`, que calcula as claims com as mesmas regras do `claims` do ms-identity (na organização da pessoa, se `organizationId` for omitido).
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

Vínculos (`memberships`): cada pessoa na própria organização, com o papel mapeado. No protótipo o administrador enxerga todas as organizações (Dashboard e Equipes); como o backend não tem papel acima da organização, cada `ADMIN` recebe também um vínculo `ADMIN` nas outras organizações. Hoje isso dá a Helena Costa um vínculo na Atlas: 19 vínculos para 18 pessoas, e o login dela pede a escolha da organização.

Atribuições a projetos (`projectAssignments`): o líder do projeto; gestores (PM) e líderes de equipe de cada equipe do projeto, além do líder da equipe; e todo `VIEWER` da organização (Sérgio Tavares) em todos os projetos dela.

Registros deixados de fora, listados em `excluded`: entradas de auditoria que o backend não registra (tentativas negadas, notificações, administração de usuários; não há nenhuma no cenário atual) e dois registros do protótipo que cruzam organizações e que nenhum serviço aceitaria: o comentário `cm12` (autor da Atlas em tarefa da Vetor) e a entrada `au69` (gestor da Vetor atribuindo tarefa da Atlas). O resultado: 33 comentários e 74 eventos de auditoria.

## Ordem e comandos

A ordem é **identity → projects → audit**. Cada passo escreve apenas o próprio schema, só insere (ids determinísticos; nada é atualizado nem apagado), recusa `NODE_ENV=production` e exige banco com sufixo `_dev`.

### Só na primeira execução

Cada serviço é semeado **uma vez**. Depois disso o seed não escreve nada e o relatório JSON traz `"status": "already seeded"`; o que as pessoas alteraram ou apagaram depois (e-mail, nome, vínculo, membro de equipe, atribuição a projeto, tarefa, comentário) não é restaurado nem sobrescrito. O marcador de "já semeado" de cada serviço:

| Serviço | Marcador | Por quê |
|---|---|---|
| identity | alguma organização do cenário existe | o seed roda numa única transação sob advisory lock: ou gravou tudo, ou nada |
| projects | a linha `Project` daquele projeto existe (decidido projeto a projeto) | o seed grava uma transação por projeto e projetos não podem ser apagados (só arquivados). Um projeto com linha foi semeado por inteiro; um projeto sem linha nunca foi, como depois de uma execução interrompida entre dois projetos, e é gravado completo. Tarefas, comentários, sprints, épicos e marcos apagados de um projeto existente não voltam |
| audit | algum evento do cenário existe em `audit.events` | uma única transação sob advisory lock, como no identity |

Nenhum serviço ganhou tabela de marcador ou migration: o próprio dado do cenário serve de marcador, o que também cobre bancos semeados antes desta regra (eles já contam como semeados no primeiro deploy com ela).

### Divergências viram avisos, não erros

O seed não falha por diferença entre o banco e o cenário. Tudo vai para `warnings` no relatório JSON, com código de saída 0:

- contagens por chave primária menores que o cenário (linhas apagadas depois da primeira execução, ou que não puderam ser gravadas), por tipo de linha;
- usuário do cenário com e-mail ou nome diferente do cenário (`differs from the scenario (e-mail)`), mantido como está;
- na primeira execução do identity, e-mail do cenário que já pertence a outra conta: aquele usuário fica de fora, com credencial, vínculos, membros de equipe e atribuições a projeto dele, e equipes que ele lidera também (o líder precisa ser membro);
- na primeira gravação de um projeto, chave (`PCL`, por exemplo) já usada por outro projeto da organização: o projeto inteiro fica de fora.

Erros de verdade continuam falhando o seed com código diferente de 0: banco inacessível, schema sem migrar, violação de restrição por bug.

```powershell
pnpm db:migrate
pnpm db:identity:migrate
pnpm db:audit:migrate
pnpm --filter "@axial/demo-fixtures..." build
$env:AXIAL_DEMO_PASSWORD = "<senha local de 10+ caracteres>"
pnpm db:seed:demo        # identity, projects e audit (scripts/seed-demo.mjs)
```

- `pnpm db:identity:seed` roda só o seed do ms-identity; `pnpm db:seed`, só o do ms-projects; `pnpm db:audit:seed`, só o do ms-audit.
- Entradas de teste: `pnpm --filter @axial/ms-identity db:seed:test` (usa `IDENTITY_TEST_DATABASE_URL`), `pnpm --filter @axial/ms-projects db:seed:test` (usa `TEST_DATABASE_URL`) e `pnpm --filter @axial/ms-audit db:seed:test` (usa `AUDIT_TEST_DATABASE_URL`); todas aceitam somente bancos `_test`.
- `AXIAL_DEMO_PASSWORD` (10 a 128 caracteres, a mesma política de senha do ms-identity) é obrigatória para o seed do identity: é a senha de todas as contas que ele cria. Vem do ambiente ou do `.env` e nunca é versionada. `pnpm start`/`pnpm perf` usam, sem ela, a fixture só local `localDemoPassword` de `scripts/performance/run.mjs`.
- As datas são calculadas no momento da primeira execução. Repetir o seed depois não move nada: ele não escreve mais. Para datas atuais, recrie um banco de desenvolvimento descartável.
- Em deploy, `deploy/setup.sh` roda os seeds de identity, projects e audit quando `AXIAL_SEED=true` (padrão), depois das migrations. Migration com falha falha o setup; seed com falha **não**: o setup imprime o erro e `[setup] AVISO: seed de demonstração falhou: …`, pula os passos seguintes e termina com sucesso, e os serviços sobem. `AXIAL_DEMO_PASSWORD` precisa estar no ambiente do serviço `setup` (`deploy/compose.yaml` a repassa); sem ela o setup avisa e pula o seed inteiro (nada muda se o demo já foi semeado). Ver `deploy/README.md` e `sh deploy/setup.test.sh`.

## ms-projects

`apps/api/prisma/demo-seed.ts` grava uma transação por projeto (serializada por advisory lock) com `createMany({ skipDuplicates: true })`, só para projetos cuja linha ainda não existe, preservando `createdAt`, `updatedAt`, `completedAt`, refs e números (o número é o sufixo da ref). `taskSequence` recebe o maior número, então a próxima tarefa criada pela API continua a sequência (`PCL-120`). Se a chave do projeto já pertencer a outro id na organização, o projeto fica de fora com um aviso; depois, conta cada linha do cenário pelo próprio id e avisa (sem abortar) se faltar alguma, seja por remoção posterior, seja por um `skipDuplicates` causado por outra chave única.

**Sem eventos de outbox.** O histórico do cenário vai para o ms-audit pelo seed dele. Publicar o seed pelo outbox duplicaria a auditoria e dispararia atualizações em tempo real e notificações de coisas que não aconteceram. A versão das linhas semeadas é 1; as versões dos agregados nos eventos de auditoria refletem a ordem do histórico, não a coluna `version`.

O projeto `AXL` do seed anterior não é mais criado nem é removido: se existir em um banco antigo, continua lá, na organização `aaaaaaaa-…`.

## ms-audit

`apps/ms-audit/src/seed-demo.ts` valida cada evento com `domainEventEnvelopeSchema` (o mesmo contrato do consumidor) e, se nenhum evento do cenário existir ainda, insere todos em `audit.events` com `ON CONFLICT (id) DO NOTHING`, numa transação sob advisory lock. `actor_source` vem da origem do protótipo (`ui`, `mcp`, `automation`), `correlation_id` é `demo-seed-<id legado>` e `data` traz `before`/`after` do protótipo com ids remapeados.

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

## ms-identity

`apps/ms-identity/src/seed-demo.ts` (lógica em `src/demo-seed.ts`) grava, só no schema `identity`, numa transação serializada por advisory lock e com `ON CONFLICT DO NOTHING`:

- `organizations` com `id` de `organizations[].id` e o nome do protótipo;
- `identity."user"` do BetterAuth com `id = users[].id`, nome e e-mail do cenário, `emailVerified = true` e `mustChangePassword = false`;
- `identity.account` com a credencial (`providerId = 'credential'`, id determinístico `demoId("account:<id legado>")`), senha `AXIAL_DEMO_PASSWORD` com `hashPassword` do BetterAuth (scrypt com sal próprio por conta), o mesmo formato que o signup grava. Só contas ainda sem credencial recebem hash, então repetir o seed não refaz hashes nem troca senhas;
- `members` a partir de `memberships` (papel já mapeado, `title` de `users[].title`, ativo);
- `teams` com descrição e `lead_user_id`, e `team_members` a partir de `teamMemberships`;
- `project_assignments` a partir de `projectAssignments`.

Tudo isso só quando nenhuma organização do cenário existe. Antes de gravar, o seed deixa de fora (com aviso) os usuários cujo e-mail do cenário já pertence a outra conta (outro id), com o que depende deles; depois, conta cada linha do cenário pela chave primária (usuários só pelo id, sem exigir o e-mail do cenário) e avisa se faltar alguma ou se e-mail ou nome divergirem. Os gatilhos de outbox das tabelas de domínio registram as linhas inseridas, como em qualquer escrita (o identity não tem publicador do outbox hoje); uma segunda execução não insere nada e, portanto, não gera eventos nem refaz hashes de senha.

Com isso, as claims emitidas pelo ms-identity no login real são iguais às de `claimsFor` e às dos tokens de desenvolvimento. `apps/ms-identity/test/seed.mjs` (parte de `pnpm test:identity:integration`) confere isso: semeia duas vezes, faz login de Helena Costa (escolha entre Vetor Labs e Atlas, depois tokens de cada uma) e de Ricardo Nogueira (tokens direto) e compara as claims dos access tokens com `claimsFor`. Depois troca o e-mail de um usuário semeado e remove um vínculo: a execução seguinte sai com 0, `already seeded`, avisos para os dois e nada reinserido. Num segundo banco descartável, um e-mail do cenário já pertence a outra conta antes da primeira execução: aquele usuário é pulado com aviso. Os testes equivalentes de projects (`apps/api/test/integration/demo-seed.test.ts`: tarefa e comentário apagados não voltam, projeto ausente é completado, chave tomada pula o projeto) e de audit (`apps/ms-audit/test/seed.mjs`: evento removido não volta) cobrem os outros serviços.
