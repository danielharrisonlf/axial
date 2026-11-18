# Deploy no Dokploy

Configuração usada na VPS de demonstração. O Dokploy clona este repositório e sobe `deploy/compose.yaml`.

## Peças no Dokploy (projeto **Axial**)

| Serviço Dokploy | Tipo | Observação |
| --- | --- | --- |
| `axial-db` | PostgreSQL 16 | banco `axial_dev` (o seed de demonstração exige o sufixo `_dev`); cada microsserviço usa o próprio schema |
| `axial-redis` | Redis 7 | filas BullMQ e invalidações de tempo real |
| `axial` | Compose (Git: este repositório, branch `dev`, `./deploy/compose.yaml`) | setup + 7 serviços NestJS + Workspace + Insights |

## Imagens (`deploy/Dockerfile`)

Um build do monorepo, três imagens finais:

- `backend`: os sete serviços NestJS usam a mesma imagem; o `command` e o `working_dir` escolhem o serviço;
- `web` e `insights`: arquivos estáticos em nginx com gzip, cache de um ano para `/assets` (nomes com hash) e `no-cache` para `index.html` e `remoteEntry.js`. O Insights responde com CORS porque o Workspace o carrega de outro domínio (Module Federation).

O endereço do remote do Insights entra no build do Workspace pelo argumento `INSIGHTS_REMOTE_ENTRY`.

## Primeiro passo de cada deploy

O serviço `setup` roda `deploy/setup.sh` uma vez, antes dos demais (`service_completed_successfully`):

1. gera o par de chaves RS256 no volume `axial-keys` se ele não existir (as chaves nunca entram na imagem nem no Git);
2. aplica as migrations de projects, identity, notifications e audit;
3. roda o seed de demonstração Vetor Labs em identity, projects e audit, nessa ordem (só insere o que falta; desligue com `AXIAL_SEED=false`; ver `docs/demo-seed.md`). Com `AXIAL_SEED=true`, `AXIAL_DEMO_PASSWORD` (10 a 128 caracteres) é obrigatória: é a senha das contas de demonstração e, sem ela, o setup para com erro antes de semear. Ela só vale para contas criadas pelo seed; repetir o deploy com outra senha não altera as contas existentes.

## Variáveis (aba Environment do Compose no Dokploy)

```
PUBLIC_HOST=kairos.noxlabs.tech
WEB_HOST=kairos.noxlabs.tech
POSTGRES_URL=postgresql://axial:<senha>@<host interno do axial-db>:5432/axial_dev
REDIS_URL=redis://default:<senha>@<host interno do axial-redis>:6379
BETTER_AUTH_SECRET=<32+ caracteres aleatórios>
AXIAL_SEED=true
AXIAL_DEMO_PASSWORD=<senha das contas de demonstração, 10+ caracteres>
```

## Domínios (HTTPS com Let's Encrypt)

| Endereço | Serviço | Porta |
| --- | --- | --- |
| `https://<WEB_HOST>` | web (Workspace) | 80 |
| `https://insights.<PUBLIC_HOST>` | insights | 80 |
| `https://api.<PUBLIC_HOST>` | gateway (REST, `/mcp`, `/ws`) | 3000 |
| `https://docs.<PUBLIC_HOST>` | api (Swagger em `/docs`) | 3001 |

`sslip.io` resolve `<nome>.179-66-152-186.sslip.io` para o IP da VPS, o que permite HTTPS sem domínio próprio. Com um domínio próprio, troque `PUBLIC_HOST` e os domínios no Dokploy e faça um novo deploy (o Workspace precisa ser recompilado com o novo endereço do Insights).

## Conectar o MCP a Claude, ChatGPT ou Cursor

O MCP fica em `https://api.<PUBLIC_HOST>/mcp` (hoje `https://api.kairos.noxlabs.tech/mcp`). O usuário cola só essa URL no cliente e entra com o e-mail e a senha do Kairos; o cliente descobre o servidor de autorização (ms-identity), registra-se sozinho e renova o acesso sem novo login por até 30 dias de uso.

| Cliente | Como conectar |
| --- | --- |
| Claude (web e Desktop) | Configurações → Conectores → Adicionar conector personalizado → cole a URL → Conectar. Em planos Team/Enterprise, um proprietário adiciona o conector para a organização. |
| Claude Code | `claude mcp add --transport http kairos https://api.kairos.noxlabs.tech/mcp` e, dentro do Claude Code, `/mcp` → `kairos` → Authenticate. |
| ChatGPT | Configurações → Apps e conectores → Configurações avançadas → modo desenvolvedor; crie um conector com a URL e autenticação OAuth. |
| Cursor | `~/.cursor/mcp.json`: `{"mcpServers":{"kairos":{"url":"https://api.kairos.noxlabs.tech/mcp"}}}`; em Settings → MCP, clique em Login no servidor `kairos`. |

A conta precisa estar ativa numa organização e ter trocado a senha provisória. Contas em mais de uma organização escolhem a organização no login. Detalhes do protocolo, regras de `redirect_uri`, escopos e prazos estão no [README do ms-identity](../apps/ms-identity/README.md#oauth-21-para-clientes-mcp).

Rotas públicas novas no gateway (as demais não mudaram):

| Caminho | Serviço |
| --- | --- |
| `/.well-known/oauth-protected-resource` e `/.well-known/oauth-protected-resource/mcp` | mcp-server (RFC 9728) |
| `/.well-known/oauth-authorization-server/identity`, `/.well-known/openid-configuration/identity` | ms-identity (RFC 8414) |
| `/identity/...` (`/identity/oauth/authorize`, `token`, `register`, `revoke`, `/identity/.well-known/*`) | ms-identity |

Variável nova no `compose.yaml`: `IDENTITY_OAUTH_RESOURCE=https://api.${PUBLIC_HOST}/mcp` no ms-identity. Ela é derivada de `PUBLIC_HOST`; não há variável nova a configurar no Dokploy. A migration `004_oauth` é aplicada pelo `setup` no próximo deploy.

Para conferir depois do deploy:

```bash
curl -s https://api.kairos.noxlabs.tech/.well-known/oauth-protected-resource/mcp
curl -s https://api.kairos.noxlabs.tech/.well-known/oauth-authorization-server/identity
curl -si -X POST https://api.kairos.noxlabs.tech/mcp | grep -i www-authenticate
```

## Contas: quem cadastra o quê

- **Empresas se cadastram sozinhas**: `POST /api/v1/auth/signup` cria a conta, a empresa e o vínculo de administrador dela (`IDENTITY_SIGNUP_ENABLED=true` no `compose.yaml`).
- **Administradores convidam por link**: `POST /api/v1/invitations` devolve um link `https://<WEB_HOST>/#/convite/<token>` válido por 7 dias e de uso único. A pessoa convidada cria a senha ou, se já tem conta, confirma a própria senha.
- **Uma conta, várias empresas**: o login sem empresa devolve a lista para escolher; o Workspace troca a sessão pelo token da empresa escolhida com `X-Organization-Id`.
- O login pelo Workspace grava o cookie de sessão `kairos_session` (HttpOnly, Secure, SameSite=Lax) no host `api.<PUBLIC_HOST>`; o Workspace em `<WEB_HOST>` é o mesmo site e o usa em `POST /api/v1/auth/session`.

Detalhes, formatos e regras no [README do ms-identity](../apps/ms-identity/README.md#contas-empresas-e-convites).

Variáveis novas no `compose.yaml`, todas derivadas do que já existe (nada novo a configurar no Dokploy):

| Serviço | Variável | Valor |
| --- | --- | --- |
| ms-identity | `IDENTITY_TRUST_PROXY` | `1` (o gateway é o único proxy confiável) |
| ms-identity | `IDENTITY_SIGNUP_ENABLED` | `true` |
| ms-identity | `IDENTITY_WEB_URL` | `https://${WEB_HOST}` |
| ms-identity | `IDENTITY_SESSION_COOKIE_SECURE` | `true` |
| gateway | `GATEWAY_TRUST_PROXY` | `1` (o Traefik do Dokploy fica na frente) |

Endereço do cliente: o Traefik acrescenta o IP do cliente em `X-Forwarded-For`; o gateway confia nesse salto e manda aos serviços só esse endereço; o ms-identity confia no gateway. Assim os limites de tentativa de login, signup e convites contam por cliente, e não mais pelo IP do gateway. Se outro proxy for colocado na frente do Traefik, aumente `GATEWAY_TRUST_PROXY`.

Rota pública nova no gateway: `/api/v1/invitations` (ms-identity). A migration `005_profiles_invitations` é aplicada pelo `setup` no próximo deploy.

## Tokens de teste (Swagger e MCP)

Os tokens são assinados pela chave do servidor, então são gerados dentro do contêiner:

```bash
docker exec $(docker ps -qf name=-api-) sh -c 'cd /app && node scripts/dev-identity.mjs token PROJECT_MANAGER'
```

Os serviços rodam com `NODE_ENV=development` de propósito (Swagger e seed disponíveis). É um ambiente de demonstração: não use para dados reais.
