# Relatório — provedores de notificações

Foram adicionados adaptadores HTTP diretos para Resend (email), SMSGo (SMS) e WhatsApp Cloud API da Meta, mantendo o gateway HTTPS anterior como alternativa explicitamente configurada. Os adaptadores usam timeout, bloqueiam redirecionamentos e não expõem credenciais ou conteúdo das respostas em erros. Os textos enviados são genéricos e não incluem conteúdo privado dos projetos. O WhatsApp usa um template previamente aprovado, sem parâmetros.

Configuração por canal e migração: [README do serviço](../apps/ms-notifications/README.md). Credenciais, domínio autorizado na Resend, conta e número da Meta, e template aprovado devem ser fornecidos no ambiente; não há credenciais ou templates cadastrados nesta entrega. A integração não executou envios reais nem comprovou entrega.

Validação local: lint, typecheck, build, testes unitários do monorepo e oito cenários de navegador passaram; os testes do serviço incluem os adaptadores e o roteamento para cada provedor com chamadas simuladas. A integração com PostgreSQL e Redis aplicou as migrations 002 e 003 e verificou isolamento, alteração de contato, expiração e replay de código, cotas, canais sem configuração e tratamento de resultado incerto. Uma revisão independente conferiu os contratos oficiais e as proteções de concorrência. A imagem Docker foi construída e executada como usuário não root; as três migrations passaram duas vezes em PostgreSQL isolado, e os endpoints de saúde responderam com Redis de teste. Nenhum provedor externo foi chamado nos testes. O [CI do commit 0c18a65](https://github.com/danielharrisonlf/axial/actions/runs/42757161035) terminou com sucesso, inclusive os testes de navegador.

O serviço verifica a posse de emails e números com código de seis dígitos, HMAC, expiração, limites persistentes e confirmação transacional. A alteração do destino ou a desativação apaga essa verificação. A migration 003 remove também as marcas anteriores, exigindo nova verificação; os envios anteriores ficam bloqueados até a confirmação. Uma chave global de configuração permanece como bloqueio adicional, não comprovação de posse. A janela entre a última verificação e a chamada externa não é atômica. A configuração de WhatsApp depende de um template de autenticação aprovado.

Requisições aceitas são marcadas `accepted`, sem afirmar entrega. Se ocorrer erro ou o lease expirar, a entrega fica `unknown` e não é reenviada automaticamente, pois o provedor pode já ter aceitado a chamada. Por prudência, isso também inclui falhas de autenticação anteriores ao envio; é necessário reconciliar o resultado operacionalmente. Resend recebe uma chave de idempotência válida por até 24 horas; SMSGo usa `reference` para correlação, sem garantia equivalente aqui. Não há callback de status implementado.

Referências: [Resend — envio de email](https://resend.com/docs/api-reference/emails/send-email), [Resend — idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys), [SMSGo — envio de SMS](https://doc.smsgo.com.br/enviar-um-sms-39041498e0), [Meta — WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

Semantica não estava disponível; decisões e evidências foram registradas no repositório.

## Referência da Encibra

Foi inspecionado o checkout local `encibra/ms-notificacao-backend` na branch `dev`, commit `6f2d04f`. O serviço usa NestJS e SQS, SMTP para email e WhatsApp Cloud API com templates e escolha de número remetente. Ele também expõe um GET para verificar a inscrição do webhook da Meta e um POST que registra falhas. O Axial usa BullMQ, Resend e SMSGo, conforme as escolhas deste projeto.

O fluxo de webhook é uma referência para futura reconciliação de estados. Antes de recebê-lo no Axial, é preciso validar a assinatura dos POSTs com o corpo bruto, correlacionar o ID da Meta com `provider_id`, persistir transições `sent`/`delivered`/`read`/`failed` de forma idempotente e limitar os dados de log. O código de referência não faz essas validações nem atualiza o estado das entregas. O Axial continua reportando `accepted` como aceite da API, sem alegar entrega final.

