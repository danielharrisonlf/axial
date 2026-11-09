# ms-notifications

Consome `axial-notifications` (BullMQ) e mantém dados no schema PostgreSQL `notifications`. É um consumidor independente; não acessa schemas de identidade ou projetos. Não existem fornecedor, credenciais, números ou confirmação de entrega incorporados.

## Configuração e execução

Node e pnpm conforme a raiz. Execute migrations antes do processo:

```powershell
$env:NOTIFICATIONS_DATABASE_URL = 'postgresql://.../axial_dev'
$env:NOTIFICATIONS_REDIS_URL = 'redis://localhost:6389/0'
$env:NOTIFICATIONS_PUBLIC_KEY_PATH = 'C:/caminho/public.pem'
$env:NOTIFICATIONS_JWT_ISSUER = 'http://localhost:3000/identity'
$env:NOTIFICATIONS_JWT_AUDIENCE = 'axial-projects'
pnpm --filter @axial/ms-notifications db:migrate
pnpm --filter @axial/ms-notifications dev
```

Porta padrão 3003 (`NOTIFICATIONS_PORT`); prefixo `/api/v1`. O serviço verifica JWT RS256, issuer, audience, exp, iat, sub, organizationId e role. As preferências e entregas pertencem exclusivamente ao subject e organização do token; administradores não podem consultar ou modificar as de outros. Revogações de identidade são refletidas apenas na expiração do JWT; não existe introspecção. A verificação da posse do endereço e consentimento do destinatário deve ser executada pelo gateway antes do envio. A API só permite ao usuário autenticado declarar seu próprio contato, não prova a posse dele.

- `GET /notification-preferences`: preferências próprias.
- `PATCH /notification-preferences/:channel`: `channel` é `email`, `sms` ou `whatsapp`; corpo exato `{ "enabled": true, "destination": "..." }`. Telefone em E.164. Padrão é desabilitado; salvar representa opt-in, e é possível desabilitar com `enabled: false`.
- `GET /notifications`: até 100 entregas próprias recentes e respectivos estados.
- `POST /notifications/:id/retry`: antecipa tentativa própria pendente/falha; não reinicia envio em andamento ou aceito.
- `GET /health/live`: verifica o processo. `GET /health/ready`: verifica a migração do banco, se o worker está ativo e a conexão com o Redis por ping com prazo limitado; não valida o provedor.

## Eventos e gateway

Valida envelope v1 do outbox. Para eventos `task.*`, exceto `task.deleted`, apenas `data.after.assigneeId` UUID é elegível, incluindo `task.completed` e `task.assigned`. É uma referência estabelecida pelo produtor; somente será destinatário se já existir uma preferência ativa criada com token desse mesmo usuário e organização. Eventos sem responsável ou sem preferência são registrados sem criar entrega; habilitar uma preferência depois não retroage. A mudança simultânea de responsável e status usa o responsável de `after`. Outros tipos são registrados, mas não geram entregas. A preferência é consultada quando a entrega é reivindicada. Uma alteração ou desativação após essa leitura não cancela uma requisição em curso; não há atomicidade entre os serviços. O gateway deve verificar o consentimento e a posse do destino imediatamente antes do envio. O evento armazenado retém apenas ID, organização e tipo, não os dados completos.

Opcionalmente configure `NOTIFICATIONS_PROVIDER_URL` (HTTPS) e `NOTIFICATIONS_PROVIDER_TOKEN` para um gateway externo confiável que implemente os três canais. Sem ambos, as entregas permanecem pendentes. O serviço envia POST JSON `{id,channel,destination,eventType}`, `Authorization: Bearer <token>` e `Idempotency-Key: <id>`. Exige resposta 2xx JSON `{ "accepted": true, "id": "identificador do provedor" }`; isso marca `accepted`, que significa **aceito pelo gateway**, não entregue ao destinatário. O gateway deve autenticar, validar consentimento e posse do destino, rejeitar canais não configurados, manter idempotência durável por `Idempotency-Key`, e integrar provedores reais de email, SMS e WhatsApp. Ele deve responder com o mesmo resultado quando a requisição for repetida. Não existe callback, rastreamento de entrega, modelos, confirmação de leitura nem integração direta com fornecedor aqui. Eventos são genéricos: o gateway deve usar mensagem apropriada ao tipo, sem dados privados do projeto.

Cada evento é inserido e as entregas elegíveis são criadas na mesma transação. A chave única `(event_id,user_id,channel)` e o registro de evento fornecem deduplicação persistente. Processamento de envio reivindica registro com lease e `SKIP LOCKED`, e falhas retornam ao estado pendente com backoff. O envio é ao menos uma vez: timeout, parada ou perda de lease podem repetir requisições; **idempotência no gateway é obrigatória** para evitar duplicatas. Nenhum serviço externo configurado significa nenhum envio. Persistência do Redis e recuperação do outbox publicado são responsabilidades operacionais conforme a arquitetura. Não apague registros de deduplicação enquanto eventos puderem ser reentregues. Configure acesso restrito ao banco/Redis e rotação de token; retenção, criptografia de contatos em repouso, limitação de taxa e observabilidade operacional devem ser estabelecidas antes de produção.

## Testes

```powershell
pnpm --filter @axial/ms-notifications build
$env:TEST_DATABASE_URL = 'postgresql://axial:axial_local_only@localhost:5550/axial_test'
$env:TEST_REDIS_URL = 'redis://localhost:6389/14'
pnpm --filter @axial/ms-notifications test:integration
```

O teste requer URL de banco terminado em `_test`, permissão PostgreSQL `CREATEDB` e banco lógico Redis não zero dedicado. Cria um banco temporário exclusivo terminado em `_test`, aguarda o fechamento das conexões e o remove; não usa `FLUSHDB` e remove apenas os próprios jobs Redis. Confere consumo BullMQ, deduplicação, preferências, isolamento por usuário e organização, retry, confirmação de aceite, minimização do payload, autenticação JWT HTTP e readiness com Redis indisponível. Não prova entrega externa.
