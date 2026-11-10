# ms-notifications

Consome `axial-notifications` (BullMQ) e mantém dados no schema PostgreSQL `notifications`. É um consumidor independente; não acessa schemas de identidade ou projetos. Possui adaptadores diretos para Resend, SMSGo e WhatsApp Cloud API da Meta. Nenhuma credencial ou confirmação de entrega vem incorporada.

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

Porta padrão 3003 (`NOTIFICATIONS_PORT`); prefixo `/api/v1`. O serviço verifica JWT RS256, issuer, audience, exp, iat, sub, organizationId e role. As preferências e entregas pertencem exclusivamente ao subject e organização do token; administradores não podem consultar ou modificar as de outros. Revogações de identidade são refletidas apenas na expiração do JWT; não existe introspecção. A API permite declarar o próprio contato, mas não verifica sua posse.

- `GET /notification-preferences`: preferências próprias.
- `PATCH /notification-preferences/:channel`: `channel` é `email`, `sms` ou `whatsapp`; corpo exato `{ "enabled": true, "destination": "..." }`. Telefone em E.164. Padrão é desabilitado; uma preferência habilitada demonstra a escolha do usuário, mas não verifica posse do destino. Alterar o endereço ou desabilitar invalida a verificação.
- `GET /notifications`: até 100 entregas próprias recentes e respectivos estados.
- `POST /notifications/:id/retry`: antecipa tentativa própria pendente/falha; não reinicia envio em andamento, aceito ou com resultado desconhecido.
- `GET /health/live`: verifica o processo. `GET /health/ready`: verifica a migração do banco, se o worker está ativo e a conexão com o Redis por ping com prazo limitado; não valida o provedor.

## Eventos e provedores

Valida envelope v1 do outbox. Para eventos `task.*`, exceto `task.deleted`, apenas `data.after.assigneeId` UUID é elegível. Eventos sem responsável ou sem preferência ativa são registrados sem criar entrega; habilitar uma preferência depois não retroage. Outros tipos são registrados, mas não geram entregas. O evento armazenado retém apenas ID, organização e tipo, não os dados completos.

Para provedores diretos, configure cada canal independentemente: `RESEND_API_KEY` e `RESEND_FROM` para email; `SMSGO_API_KEY` e `SMSGO_SMS_TYPE_ID` para SMS; `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_TEMPLATE_NAME`, `META_LANGUAGE_CODE` e `META_GRAPH_VERSION` para WhatsApp. O tipo de SMS deve ser um ID positivo adequado ao uso transacional, obtido no catálogo da conta SMSGo; não é inferido automaticamente. O remetente Resend precisa de domínio autorizado; o template Meta deve estar aprovado e não ter parâmetros. Dados secretos devem vir do gerenciador de segredos do ambiente, nunca do Git. Canais sem configuração permanecem pendentes. As mensagens usam texto genérico sem dados privados de projeto.

**Bloqueio de envio:** `NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION=true` é necessário, mas não suficiente. Cada preferência precisa de `verified_at`, que só pode ser registrado por um processo externo confiável após verificar a posse do destino. Esse processo ainda não está implementado; não há endpoint público para marcar um contato como verificado. Até isso existir, não há fluxo de produção completo para habilitar novos contatos. A preferência é revalidada imediatamente antes do envio, mas ainda existe uma janela de concorrência entre a revalidação e a chamada externa.

O gateway HTTPS anterior continua disponível quando `NOTIFICATIONS_PROVIDER_URL` e `NOTIFICATIONS_PROVIDER_TOKEN` estão ambos configurados; ele tem precedência explícita sobre os adaptadores diretos. O serviço envia `{id,channel,destination,eventType}` e chave de idempotência, e espera `{accepted:true,id}`. Esse gateway deve autenticar, verificar consentimento e manter idempotência durável.

Cada evento e suas entregas são registrados atomicamente e deduplicados por ID. Um timeout, erro do provedor ou lease expirado produz estado `unknown`: a requisição pode ter sido aceita e não será repetida automaticamente. Isso também inclui erros anteriores ao envio que os adaptadores ainda não classificam separadamente; exigem reconciliação operacional. Resend recebe chave de idempotência válida por 24 horas; SMSGo e Meta não têm garantia equivalente nesta implementação. `accepted` significa aceite da API, não entrega. Não há webhook ou confirmação de leitura. Configure acesso restrito ao banco/Redis e rotação de segredos; retenção, criptografia de contatos, rate limiting e observabilidade ainda precisam ser definidos.

## Testes

```powershell
pnpm --filter @axial/ms-notifications build
$env:TEST_DATABASE_URL = 'postgresql://axial:axial_local_only@localhost:5550/axial_test'
$env:TEST_REDIS_URL = 'redis://localhost:6389/14'
pnpm --filter @axial/ms-notifications test:integration
```

O teste requer URL de banco terminado em `_test`, permissão PostgreSQL `CREATEDB` e banco lógico Redis não zero dedicado. Cria um banco temporário exclusivo terminado em `_test`, aguarda o fechamento das conexões e o remove; não usa `FLUSHDB` e remove apenas os próprios jobs Redis. Confere consumo BullMQ, deduplicação, preferências, isolamento por usuário e organização, retry, confirmação de aceite, minimização do payload, autenticação JWT HTTP e readiness com Redis indisponível. Não prova entrega externa.
