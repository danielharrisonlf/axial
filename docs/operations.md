# Operação

## Variáveis

| Variável | Uso |
| --- | --- |
| NODE_ENV | development, test ou production |
| PORT | Porta HTTP; padrão 3001 |
| DATABASE_URL | PostgreSQL do serviço, com schema=projects |
| TEST_DATABASE_URL | Banco isolado com nome terminado em _test |
| REDIS_URL | Redis ou Redis TLS das filas |
| TEST_REDIS_URL | Redis de teste; localmente banco lógico 15 |
| JWT_ISSUER / JWT_AUDIENCE | Emissor e audiência esperados |
| JWT_PUBLIC_KEY_PATH | Chave pública SPKI PEM; caminho relativo ao diretório de execução |
| JWT_JWKS_URL | Alternativa HTTPS com rotação via JWKS |
| RELAY_ENABLED | true para relay; false para testes determinísticos |
| RELAY_POLL_MS | Intervalo entre batches; padrão 1000, entre 50 e 60000 |
| CORS_ORIGINS | Origens HTTP permitidas, separadas por vírgula |

Um método de verificação JWT é sempre obrigatório. Quando chave e JWKS são informados, a chave local tem precedência. Configuração inválida impede inicialização. O exemplo .env usa credenciais exclusivamente locais; produção deve fornecer seus próprios segredos e identidade.

## Banco e migrations

`pnpm db:migrate` usa migrate deploy e migrations versionadas; não usa sincronização de schema ou reset. Gere o cliente com `pnpm db:generate`. O serviço não deve receber permissão para schemas de outros serviços. Para produção, use uma credencial de migrations separada da credencial de execução, restrita a USAGE no schema projects e às operações necessárias em suas tabelas. Credenciais locais do Compose são superusuário apenas para facilitar o desenvolvimento.

Backups precisam incluir o outbox. A fila não substitui o PostgreSQL como registro durável dos eventos. Políticas de expurgo/arquivo devem ser adotadas junto das exigências de auditoria e dos consumidores.

## Filas e saúde

Readiness consulta PostgreSQL e, quando RELAY_ENABLED=true, Redis. Liveness informa se o processo responde. O processo trata shutdown do Nest: drena o batch do relay antes de fechar filas e banco.

Alertas recomendados: eventos com publishedAt nulo e availableAt vencido, tentativas crescentes, atraso entre occurredAt e publicação, filas acumuladas e falhas de consumidores. lastError é redigido e não contém credenciais. Leases expiradas tornam eventos elegíveis novamente.

O relay confirma enfileiramento em três destinos; não confirma entrega de e-mail/SMS/WhatsApp, gravação na futura central de auditoria ou recebimento pelo navegador. Redis com AOF e noeviction está configurado no Compose.

## Imagem

```powershell
docker build -f apps/api/Dockerfile -t axial-ms-projects:local .
```

A imagem usa Node 24 Alpine, build em estágio separado, lockfile congelado e execução como usuário não root. Configure DATABASE_URL/REDIS_URL com endereços acessíveis dentro do contêiner. Monte a chave pública somente para leitura ou use JWKS; nunca inclua a chave privada na imagem. O Dockerfile copia dependências de build também para o estágio final; uma imagem mais enxuta é uma otimização futura, sem efeito no contrato de execução.

Em produção, Swagger é desabilitado. Termine TLS e aplique limites de tráfego no futuro gateway. Não há deploy de produção nesta entrega.

## Comandos auxiliares

- `pnpm --filter @axial/ms-projects openapi`: regenera docs/api/openapi.json com relay desativado; requer configuração de autenticação e PostgreSQL disponíveis.
- `pnpm db:seed`: cria demonstração local sem reset, e recusa produção/bancos sem sufixo _dev.
- `pnpm infra:down`: para os recursos locais; preserva volumes persistentes.

As chaves de desenvolvimento geradas não são usadas em produção. Tokens locais devem ser guardados somente no ambiente de desenvolvimento e expiram em 15 minutos.
