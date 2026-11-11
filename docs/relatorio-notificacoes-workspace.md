# Relatório — interface e API de notificações

Data: 10/11/2026. Escopo: completar a vertical de notificações a partir do protótipo e do relatório de provedores, com leitura própria no ms-notifications e a tela Notificações no Workspace React.

## Entrega

### ms-notifications

- Migration **004** cria `notifications.event_preferences` com chave `(organization_id, user_id, event_type, channel)`; a ausência de linha mantém o evento habilitado e não altera envios existentes.
- O consumidor aplica a preferência por evento ao criar a entrega e a confere novamente imediatamente antes da chamada externa, junto da preferência de canal e da verificação de destino.
- `GET /notification-event-preferences` devolve a matriz evento × canal do próprio usuário; `PATCH /notification-event-preferences/:event/:channel` aceita somente eventos do catálogo.
- `GET /notification-templates` expõe o catálogo de eventos `task.*` com os textos genéricos efetivamente enviados.
- `GET /notification-providers` informa canal configurado e verificação habilitada sem revelar credenciais, remetentes ou destinos.
- `GET /notifications` passou a incluir o tipo do evento; `GET /notifications/:id` devolve o detalhe apenas do próprio usuário e organização.
- Readiness exige a migration 004. Não há mudança no significado de `accepted`: aceite da API não é confirmação de entrega.

### Workspace React

- Tela **Notificações** habilitada na navegação, com as abas Histórico de envio, Preferências, Templates e Provedores, preservando tabelas, chips, switches, painéis e drawer do protótipo.
- Histórico filtra pelas notificações do perfil ativo, exceto para quem possui `notif.manage`; o drawer mostra status, destinatário, evento, tentativas, assunto, mensagem e motivo de falha.
- Preferências evento × canal usam as capacidades `notif.view` e `notif.manage`; perfis sem gestão veem chips em vez de switches.
- Templates exibem assunto, corpo e variáveis. Provedores exibem configuração, remetente e um modal de configuração explicitamente simulado.
- Atribuir tarefa, adicionar bloqueio, iniciar e encerrar sprint geram entregas locais pelos templates e preferências. Canal sem provedor é registrado como falha; reenvio só entrega após configurar o provedor.
- O sino da topbar ganhou a entrada "Ver todas as notificações".

## Verificação

| Check | Resultado |
| --- | --- |
| `pnpm lint` | sem erros; 4 avisos preexistentes em `verification.ts` |
| `pnpm --filter @axial/web typecheck` | aprovado |
| `pnpm --filter @axial/web test:unit` | **15/15** |
| `pnpm --filter @axial/web test:e2e` | **9/9** no Chromium |
| `pnpm --filter @axial/ms-notifications build` | aprovado |
| `pnpm --filter @axial/ms-notifications test:unit` | **38/38** |
| `pnpm test:notifications:integration` | integração, HTTP e verificação aprovados em PostgreSQL/Redis descartáveis |

O teste de integração confere que uma preferência de evento desabilitada não cria entrega, que habilitá-la volta a criar e que desabilitá-la entre a reserva e o envio mantém a entrega pendente sem chamar o provedor. O teste HTTP cobre autenticação, catálogo, matriz de preferências, isolamento por usuário/organização, tipo do evento no histórico e detalhe por ID.

Evidências visuais: `output/validation/web/notifications-drawer.png` e `output/validation/web/notifications-providers.png`.

## Limites

- A tela do Workspace continua sendo **demonstração local**: não obtém sessão de identidade, não chama o ms-notifications e persiste em `axial.workspace.demo.v1`. Nenhuma mensagem real é enviada.
- Os textos do catálogo real são genéricos e não incluem dados de projeto; o protótipo usa textos ricos apenas para demonstrar a experiência. A tela não replica o conteúdo do template real no histórico.
- A configuração de provedores no navegador é simulada; em produção credenciais e remetentes vêm do ambiente do serviço.
- Preferências por evento não substituem a verificação de posse do destino. A janela entre a última checagem e a chamada externa continua não atômica.
- Não há webhook de status, confirmação de leitura nem garantia de entrega; `accepted` segue sendo aceite da API.
