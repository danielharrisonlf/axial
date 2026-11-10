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

Porta padrão 3003 (`NOTIFICATIONS_PORT`); prefixo `/api/v1`. O serviço verifica JWT RS256, issuer, audience, exp, iat, sub, organizationId e role. As preferências e entregas pertencem exclusivamente ao subject e organização do token; administradores não podem consultar ou modificar as de outros. Revogações de identidade são refletidas apenas na expiração do JWT; não existe introspecção. Um contato declarado precisa ser confirmado com código antes dos envios comuns.

- `GET /notification-preferences`: preferências próprias.
- `PATCH /notification-preferences/:channel`: `channel` é `email`, `sms` ou `whatsapp`; corpo exato `{ "enabled": true, "destination": "..." }`. Telefone em E.164. Padrão é desabilitado; uma preferência habilitada demonstra a escolha do usuário, mas não verifica posse do destino. Alterar o endereço ou desabilitar invalida a verificação.
- `POST /notification-preferences/:channel/verification`: solicita código ao contato ativo; resposta `requested` é neutra e não comprova envio. Canal sem configuração retorna 503.
- `POST /notification-preferences/:channel/verification/confirm`: recebe `{ "code": "123456" }` e devolve `verified`. Consulte `GET /notification-preferences` para o estado atual.
- `GET /notifications`: até 100 entregas próprias recentes e respectivos estados.
- `POST /notifications/:id/retry`: antecipa tentativa própria pendente/falha; não reinicia envio em andamento, aceito ou com resultado desconhecido.
- `GET /health/live`: verifica o processo. `GET /health/ready`: verifica a migração do banco, se o worker está ativo e a conexão com o Redis por ping com prazo limitado; não valida o provedor.

## Eventos e provedores

Valida envelope v1 do outbox. Para eventos `task.*`, exceto `task.deleted`, apenas `data.after.assigneeId` UUID é elegível. Eventos sem responsável ou sem preferência ativa são registrados sem criar entrega; habilitar uma preferência depois não retroage. Outros tipos são registrados, mas não geram entregas. O evento armazenado retém apenas ID, organização e tipo, não os dados completos.

Para provedores diretos, configure cada canal independentemente: `RESEND_API_KEY` e `RESEND_FROM` para email; `SMSGO_API_KEY` e `SMSGO_SMS_TYPE_ID` para SMS; `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_TEMPLATE_NAME`, `META_LANGUAGE_CODE` e `META_GRAPH_VERSION` para WhatsApp. O tipo de SMS deve ser um ID positivo adequado ao uso transacional, obtido no catálogo da conta SMSGo; não é inferido automaticamente. O remetente Resend precisa de domínio autorizado; o template Meta deve estar aprovado e não ter parâmetros. Dados secretos devem vir do gerenciador de segredos do ambiente, nunca do Git. Canais sem configuração permanecem pendentes. As mensagens usam texto genérico sem dados privados de projeto.

**Verificação e bloqueio de envio:** configure `NOTIFICATIONS_VERIFICATION_PEPPER` com 32 bytes aleatórios criptográficos codificados em base64 canônico, armazenados como segredo. Habilite cada canal de confirmação com `NOTIFICATIONS_VERIFY_EMAIL=true`, `NOTIFICATIONS_VERIFY_SMS=true` ou `NOTIFICATIONS_VERIFY_WHATSAPP=true` e suas credenciais. Para SMS de verificação, `SMSGO_VERIFICATION_SMS_TYPE_ID` deve conter o ID apropriado ao código; é independente de `SMSGO_SMS_TYPE_ID`. Para WhatsApp configure `META_VERIFICATION_TEMPLATE_NAME`, `META_VERIFICATION_LANGUAGE_CODE` e `META_VERIFICATION_TEMPLATE_MODE` (`body` ou `copy_code`) de acordo com o template de autenticação aprovado pela Meta. O template de verificação deve aceitar o código; não confunda com o template sem parâmetros usado nas notificações comuns.

O código vale por 10 minutos e seu HMAC é armazenado, sem persistir o código em texto. Há cooldown de um minuto, limite de três solicitações por hora e dez tentativas por hora para cada usuário e destino, e cinco tentativas por desafio. A migration 003 invalida verificações anteriores; os contatos precisam ser confirmados novamente. O interruptor `NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION=true` continua obrigatório para notificações comuns e não comprova posse. Uma alteração de preferência após a revalidação e antes da chamada externa ainda pode concorrer com o envio. Não rotacione o pepper sem planejamento: a rotação invalida desafios e muda as chaves dos limites; desabilite pedidos de código por pelo menos uma hora durante a rotação. Use controles de ingresso adicionais contra abuso distribuído.

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
