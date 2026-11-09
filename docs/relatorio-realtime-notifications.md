# Relatório — ms-realtime e ms-notifications

Data: 09/11/2026. Foram implementadas as etapas de sincronização e processamento de notificações do fluxo ProjectFlow, após ms-projects e ms-identity. O frontend permanece em demonstração local.

## Entrega

- `apps/ms-realtime`: consumidor da fila `axial-realtime`, WebSocket com JWT RS256, autorização por projeto verificada no ms-projects tanto na assinatura quanto antes da emissão e encerramento na expiração. O payload enviado ao navegador contém somente uma invalidação; não inclui dados completos do evento. Redis Pub/Sub distribui a invalidação entre instâncias. Há endpoints de liveness e readiness.
- `apps/ms-notifications`: consumidor da fila `axial-notifications`, persistência no schema próprio `notifications`, preferências privadas de email, SMS e WhatsApp, deduplicação persistente, reserva de entregas com lease, retentativa e backoff. Aceita gateway externo HTTPS configurável, com autenticação e chave de idempotência; o payload enviado é mínimo. O aceite pelo gateway é registrado como `accepted`, e não como confirmação de entrega.
- Scripts do monorepo e CI incluem testes próprios dos dois serviços. O teste de notificações cria um banco PostgreSQL descartável terminado em `_test` e exige permissão `CREATEDB`; testes Redis usam banco dedicado e não usam FLUSHDB.

## Verificação

Passaram localmente lint, typecheck, build, testes unitários do monorepo, 5 testes de integração do realtime e as suítes de integração e HTTP do notifications. Também passaram os testes de integração e HTTP do ms-projects e os testes de integração e interoperabilidade do ms-identity. A aceitação independente confirmou um fluxo real de criação de tarefa pela API, gravação no outbox, publicação BullMQ e recebimento da invalidação WebSocket. Nessa prova, o SQL da migration foi aplicado diretamente no banco descartável após a CLI Prisma ficar pendente; a CLI passou em duas execuções anteriores.

O [CI remoto](https://github.com/danielharrisonlf/axial/actions/runs/42560997118) passou no commit `a489be7`, incluindo a interface. As imagens Linux dos dois serviços tiveram build local aprovado; imports, presença da migration e execução como usuário não root foram conferidos. Em teste independente, ambas iniciaram com PostgreSQL, Redis e chave RSA temporária isolados, e liveness/readiness retornaram 200; a migration compilada de notifications também passou no banco descartável. Esse teste de imagem não verificou conectividade com ms-projects nem entrega por provedor externo.

A revisão independente verificou JWT, isolamento, exposição mínima, idempotência e retry. Os problemas encontrados durante a revisão foram corrigidos ou documentados como limites abaixo. O CI do repositório executa as suítes dos serviços em PostgreSQL e Redis de teste.

## Limites e operação

- Não há gateway nem provedor real configurado. O serviço não implementa diretamente um fornecedor de WhatsApp, email ou SMS; entregas permanecem pendentes até existir gateway compatível. Nenhum teste demonstrou entrega a um destinatário real. O gateway deve verificar posse, consentimento e idempotência.
- Uma alteração de preferência após a reserva da entrega não cancela uma requisição já em andamento; o gateway deve conferir consentimento imediatamente antes de enviar.
- Pub/Sub e WebSocket não oferecem replay, ordenação ou entrega durável. Clientes devem refazer leitura HTTP ao reconectar e tratar repetição/reordenação. A fila fixa exige Redis ou DB de fila isolado por ambiente; namespaces Pub/Sub também devem ser diferentes, pois Redis Pub/Sub não é isolado por DB lógico.
- A associação do destinatário é derivada do `assigneeId` em eventos de tarefas e das preferências previamente cadastradas; outros eventos não geram envios. Não há confirmação posterior de entrega ou leitura.
- A autorização do realtime depende da disponibilidade do ms-projects e do contrato JWT existente; revogações de identidade podem levar até a expiração do token para serem refletidas. As questões preexistentes em `code-review-2026-11-08.md` permanecem pendentes.

Detalhes de configuração, protocolo e operação estão nos READMEs de [realtime](../apps/ms-realtime/README.md) e [notifications](../apps/ms-notifications/README.md). Semantica não estava disponível; evidências e decisões foram registradas no repositório.
