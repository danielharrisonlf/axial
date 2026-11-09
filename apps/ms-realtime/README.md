# ms-realtime

Serviço NestJS para invalidação de dados de projeto via WebSocket. Consome `axial-realtime` em BullMQ e publica invalidações no Pub/Sub Redis para que todas as instâncias atendam seus próprios sockets. Os dados das entidades nunca são transmitidos; o cliente atualiza sua visão pela API de projetos.

## Configuração

- `REALTIME_PORT`: porta HTTP/WebSocket (padrão 3004).
- `REDIS_URL`: URL Redis usada pela fila e pelo Pub/Sub; use a mesma URL do relay para a fila. Em produção use Redis protegido, ACL, TLS e persistência para a fila; limite publicação no canal aos serviços confiáveis. Pub/Sub não é isolado por banco lógico.
- `REALTIME_NAMESPACE`: identificador obrigatório de 1 a 64 caracteres alfanuméricos, `_` ou `-`, compartilhado por instâncias do mesmo ambiente e diferente entre ambientes. O canal é `<namespace>:realtime:invalidation:v1`; testes devem usar namespace exclusivo. O namespace não é uma fronteira de segurança contra quem pode publicar no Redis.
- `JWT_ISSUER`, `JWT_AUDIENCE` e `JWT_PUBLIC_KEY_PATH` ou `JWT_JWKS_URL`: verificação RS256; JWKS exige HTTPS.
- `PROJECTS_API_URL`: URL base confiável da API de projetos, por exemplo `http://localhost:3001/api/v1`; HTTPS obrigatório em produção. O serviço encaminha o JWT ao endpoint `GET /projects/:id`, sem redirects e com timeout de 5 segundos. Um proxy de produção deve usar WSS e proteger esse serviço de acesso indevido.

Não há conexão com banco de dados de outro serviço. Revogação e mudanças de equipe são verificadas pelo ms-projects no momento da assinatura e de cada entrega; indisponibilidade, resposta negativa ou timeout fecha a conexão sem transmitir. A decisão usa as claims assinadas e as limitações de revogação do ms-projects. Autorizações podem mudar entre verificação e envio; não há transação distribuída entre serviços. Evite expor a porta diretamente à Internet sem controles de origem, limite de conexões e taxa no proxy.

## Protocolo

Conecte em `/ws` e envie em até cinco segundos `{"type":"authenticate","token":"<JWT>"}`. O token fica na primeira mensagem, não na URL. Após `{"type":"authenticated"}`, envie `{"type":"subscribe","projectId":"<UUID>"}` e aguarde `{"type":"subscribed","projectId":"<UUID>"}`; o ID solicitado não concede acesso por si só. Até 100 projetos por conexão. Envie `{"type":"unsubscribe","projectId":"<UUID>"}` para deixar de receber. Operações devem aguardar resposta antes da próxima mensagem; uma solicitação inválida ou não autorizada encerra a conexão. Expiração encerra a conexão; renove o token e conecte novamente. Use TLS para proteger o token em trânsito.

Exemplo de mensagem: `{"type":"invalidation","eventId":"...","eventType":"task.updated","occurredAt":"...","projectId":"...","aggregate":{"type":"task","id":"...","version":2}}`. Não contém `before`, `after`, autor ou outros dados do evento original. Eventos sem projectId ou fora do catálogo não são entregues; falhas de validação permanecem como jobs falhos no BullMQ.

## Entrega e recuperação

BullMQ distribui cada job entre workers; o worker publica uma vez no canal e cada instância entrega aos sockets locais autorizados. Pub/Sub é efêmero: o processamento confirmado não significa que algum cliente recebeu ou processou uma mensagem. Após desconexão do Pub/Sub, sockets são encerrados para forçar reconexão. Reconecte com token válido, reassine e execute GET das projeções necessárias; sempre faça uma leitura inicial após assinar. Não há replay, cursor ou garantia durável de entrega, exactly-once ou ordenação. A deduplicação na instância é limitada a 60 segundos e 10 mil IDs e se perde em reinício; clientes devem deduplicar por `eventId`, tolerar duplicatas e reordenação, e usar versões por agregado para descartar eventos antigos. Um evento pode ser perdido entre publicação e entrega; reconciliar periodicamente por HTTP conforme a necessidade de produto. O Redis precisa de persistência e política apropriada para a fila; perda do Redis após publicação do outbox exige recuperação operacional.

## Testes

`$env:TEST_REDIS_URL='redis://127.0.0.1:6389/14'; pnpm --filter @axial/ms-realtime test:integration`. A URL deve apontar explicitamente para um Redis de testes isolado no DB 14; os testes usam namespace Pub/Sub aleatório, IDs de jobs aleatórios e removem apenas seus próprios jobs. Não usam FLUSHDB. Não aponte para um Redis de produção: o isolamento de banco lógico não substitui uma instância isolada ou ACL.

## Saúde

`GET /health/live` retorna 200 enquanto o processo responde. `GET /health/ready` retorna 200 apenas quando a inscrição Pub/Sub está ativa, o worker está em execução e as conexões Redis necessárias estão prontas e respondem a ping; caso contrário retorna 503. As respostas não incluem detalhes de infraestrutura. O endpoint não verifica disponibilidade do ms-projects: a autorização é consultada em cada assinatura e entrega e falha fechada se indisponível.
