# ms-identity

Serviço NestJS independente, com PostgreSQL no schema `identity`. Não lê o schema `projects`. Os papéis são ADMIN, PROJECT_MANAGER, TEAM_LEAD, CONTRIBUTOR e VIEWER. A gestão é restrita a ADMIN ativo na organização do token; cada chamada consulta novamente o membro, usuário, organização e papel atual. As referências de projetos são atribuídas explicitamente por administrador, por UUID, sem validação em ms-projects: a operação que estabelece a associação deve conferir o ID na origem.

## Configuração e operação

- `IDENTITY_DATABASE_URL`: URL PostgreSQL de uma conta limitada ao schema `identity`; migrations precisam dos privilégios de criação necessários.
- `IDENTITY_PRIVATE_KEY_PATH`: caminho para chave RSA privada PKCS#8 PEM, mantida fora do repositório e acessível somente ao processo emissor.
- `IDENTITY_PUBLIC_KEY_PATH`: chave pública SPKI PEM correspondente, configurada também no ms-projects. O serviço valida o par na inicialização.
- `IDENTITY_ISSUER`: padrão `http://localhost:3000/identity`; `IDENTITY_AUDIENCE`: padrão `axial-projects`; ambos devem coincidir com ms-projects.
- `IDENTITY_PORT`: padrão 3002.
- `IDENTITY_TRUSTED_ORIGINS`: origens do Workspace, separadas por vírgula. São as únicas aceitas pelo CORS com credenciais e as únicas cujo login recebe o cookie de sessão.
- `IDENTITY_TRUST_PROXY`: número de proxies confiáveis à frente do serviço (padrão `0`, que ignora `X-Forwarded-For`). Atrás do gateway use `1`: o gateway repassa só o endereço do cliente e os limites de tentativa passam a contar por cliente. `true` (confiar em todos) é recusado.
- `IDENTITY_SIGNUP_ENABLED`: `true` liga o cadastro self-service `POST auth/signup` (padrão `false`, que responde 404).
- `IDENTITY_WEB_URL`: endereço do Workspace usado nos links de convite (padrão `http://localhost:5173`).
- `IDENTITY_SESSION_COOKIE_SECURE`: `false` só em desenvolvimento HTTP (padrão `true`).

Execute `pnpm --filter @axial/ms-identity db:migrate`, depois configure `IDENTITY_BOOTSTRAP_EMAIL`, `IDENTITY_BOOTSTRAP_PASSWORD` (10 a 128 caracteres) e `IDENTITY_BOOTSTRAP_ORGANIZATION` e execute `pnpm --filter @axial/ms-identity bootstrap`. A inicialização é transacional, serializada e recusada se já existir qualquer organização. Forneça a senha com um canal de segredos apropriado, remova-a do ambiente após o comando e não a registre em logs. O comando imprime o UUID da organização; o login exige esse UUID. Em seguida rode `pnpm --filter @axial/ms-identity dev` ou `build` e `start`. Não existem senhas, chaves ou usuários padrão.

Seed de demonstração (só desenvolvimento): `pnpm --filter @axial/ms-identity db:seed` grava o diretório do cenário fictício Vetor Labs/Atlas de `@axial/demo-fixtures` (organizações, contas BetterAuth com e-mail verificado e credencial, membros com cargo, equipes com descrição e líder, membros de equipe e atribuições a projetos), só inserindo, com ids determinísticos. Exige `AXIAL_DEMO_PASSWORD` (10 a 128 caracteres; senha de todas as contas criadas), banco `*_dev` e `NODE_ENV` diferente de `production`; `db:seed:test` usa `IDENTITY_TEST_DATABASE_URL` e exige banco `*_test`. Ver `docs/demo-seed.md`.

## HTTP

Prefixo `/api/v1`, JSON estrito. `POST auth/login` recebe `{email,password,organizationId?}` (ver "Contas, empresas e convites" abaixo) e devolve `{accessToken,expiresIn,requiresPasswordChange,sessionToken}`. Para contas provisionadas por administrador, o token tempor?rio tem audi?ncia formada pela audi?ncia configurada com sufixo `-password-change` e claim `purpose=password_change`. Ele s? ? aceito em `POST auth/password`, n?o em ms-projects ou nas rotas administrativas. Ap?s trocar a senha por outra, fa?a login novamente para obter token operacional. `POST auth/password` requer token, `{currentPassword,newPassword}`. `GET me`, `GET/PATCH organization`, `POST organizations` (o administrador atual torna-se administrador da nova organização), `GET/POST members`, `PATCH members/:id`, `GET/POST teams`, `PATCH teams/:id`, `POST teams/:id/members/:userId` e `POST members/:id/projects/:projectId` requerem bearer token; gestão exige administrador atual. Criação de membro recebe `{email,password,role}`, atualização `{role?,active?}`, equipe e organização recebem `{name}` ou `{name?,active?}` para atualização de equipe; vínculos recebem `{enabled}`. Um administrador não pode revogar seu próprio acesso. Uma conta existente só entra em outra organização por convite aceito com a própria senha. O administrador que cria uma conta por `POST members` conhece a senha inicial; o usuário deve trocá-la por uma senha privada.

## Contas, empresas e convites

Quem cadastra o quê:

- **Cadastro self-service** (`POST auth/signup`, ligado por `IDENTITY_SIGNUP_ENABLED`): cria a conta, uma empresa (organização) nova e o vínculo ADMIN da conta nela, numa transação. É assim que uma empresa começa a usar o Kairos.
- **Convite por link**: o administrador de uma empresa convida pessoas pelo e-mail, com papel, equipes e cargo. Quem abre o link cria a conta (escolhendo a senha) ou, se já tem conta, confirma a própria senha; então entra na empresa.
- **Várias empresas**: a mesma conta pode participar de várias empresas, cada uma com seu papel. O login sem `organizationId` pede a escolha.
- `POST members` (senha provisória definida pelo administrador) e o comando `bootstrap` continuam disponíveis.

| Rota | Quem | Corpo | Resposta |
| --- | --- | --- | --- |
| `POST auth/login` | público, limitado por cliente | `{email,password,organizationId?}` | com `organizationId` ou um só vínculo ativo: `{accessToken,expiresIn,requiresPasswordChange,sessionToken}`; com vários: `{requiresOrganization:true,organizations:[{id,name,role}],sessionToken}`, sem access token; sem vínculo ativo: 401 `Invalid credentials` (a sessão aberta é apagada) |
| `POST auth/session` | sessão (bearer `sessionToken` ou cookie) | `X-Organization-Id` opcional, conferido contra os vínculos | `{accessToken,expiresIn}`; sem o cabeçalho, só para conta com um vínculo |
| `POST auth/logout` | sessão (bearer ou cookie) | — | `{signedOut:true}` e apaga o cookie |
| `POST auth/signup` | público, limitado por cliente | `{name,email,password (10–128),organizationName}` | mesmo formato do login, já com tokens da empresa nova |
| `GET me` | membro ativo (access token) | — | `{userId,organizationId,role,source,name,email,title,memberships:[{organizationId,organizationName,role}]}` |
| `GET organization/members` | qualquer membro ativo | — | `[{id,name,email,title,role,active,teamIds}]` |
| `GET organization/teams` | qualquer membro ativo | — | `[{id,name,description,leadUserId,memberIds,active}]` |
| `POST invitations` | ADMIN | `{email,role,teamIds?,title?}` | `{id,url,expiresAt}`; `url` = `${IDENTITY_WEB_URL}/#/convite/<token>` |
| `GET invitations` | ADMIN | — | `[{id,email,role,teamIds,title,status,expiresAt,createdAt,createdBy,acceptedAt,revokedAt}]`, `status` = `pending`, `accepted`, `revoked` ou `expired` |
| `DELETE invitations/:id` | ADMIN | — | `{id,status:"revoked"}`; idempotente; 409 se já aceito |
| `GET invitations/token/:token` | público, limitado por cliente | — | `{organizationName,email,role,expiresAt,existingAccount}`; 404 genérico para token inválido, expirado, revogado ou usado |
| `POST invitations/token/:token/accept` | público, limitado por cliente | `{name?,password}` | mesmo formato do login, com tokens da empresa do convite |

Regras:

- Signup com e-mail já cadastrado: só com a senha correta da conta, e então a empresa nova é criada para essa conta (o nome e a senha dela não mudam). Senha errada ou corrida de cadastro respondem 409 `Signup could not be completed`, sem criar nada. A conta nova não precisa trocar a senha.
- Convite: token de 32 bytes aleatórios em base64url; só o hash SHA-256 fica em `identity.invitations`, então o link não pode ser mostrado de novo (crie outro convite). Validade de 7 dias, uso único. O convite recusa equipes inativas ou de outra empresa (400) e e-mail que já é membro ativo (409). Na aceitação, numa transação com o convite travado: conta nova exige senha de 10 a 128 caracteres; conta existente exige a própria senha (401 se errada, e o convite continua pendente); membro desativado volta com o papel e o cargo do convite; equipes desativadas desde o convite são ignoradas. Convites não geram eventos de outbox; o vínculo criado gera os eventos de membro e equipe de sempre.
- Conta com senha provisória em várias empresas recebe direto o token de troca de senha (da primeira empresa por nome), sem escolha de organização.
- Política única de senha (`PASSWORD_MIN_LENGTH`/`PASSWORD_MAX_LENGTH` em `src/common.ts`, também aplicada ao BetterAuth): de 10 a 128 caracteres no signup, na aceitação de convite, em `POST auth/password`, em `POST members`, no reset administrativo e no `bootstrap`.

### Sessão do navegador

O login, o signup e a aceitação de convite feitos a partir de uma origem de `IDENTITY_TRUSTED_ORIGINS` (cabeçalho `Origin`) gravam o token de sessão do BetterAuth no cookie `kairos_session`: `HttpOnly`, `Secure` (salvo `IDENTITY_SESSION_COOKIE_SECURE=false`), `SameSite=Lax`, `Path=/api/v1/auth`, sem `Domain` (fica preso ao host da API) e validade de 7 dias, a mesma da sessão. `https://kairos.noxlabs.tech` e `https://api.kairos.noxlabs.tech` são o mesmo site, então o Workspace chama `POST auth/session` com `credentials: "include"` e o cookie segue; de outro site, `SameSite=Lax` não o envia em POST. O CORS só devolve `Access-Control-Allow-Origin`/`Allow-Credentials` para as origens configuradas, no ms-identity e no gateway. O cookie só autentica `auth/session` e `auth/logout`; as demais rotas usam o access token. O corpo continua trazendo `sessionToken` para clientes que não são navegador.

`source` dos access tokens: `ui` para sessões de navegador (login pelo Workspace ou troca via cookie), `api` para bearer de sessão e clientes sem a origem do Workspace, `mcp` para OAuth. A origem só rotula a sessão (vai para a auditoria); nunca concede acesso.

### Endereço do cliente

Os limites de tentativa (20 por minuto por ação e cliente, por processo: `login`, `signup`, `password`, `invitation`, `invitation-accept`, `oauth-login`, `oauth-register`) usam `req.ip`. Atrás do gateway, com `IDENTITY_TRUST_PROXY=1`, `req.ip` é a última entrada de `X-Forwarded-For`, escrita pelo gateway; entradas anteriores, que o cliente poderia forjar, não contam. O gateway, por sua vez, confia em `GATEWAY_TRUST_PROXY` saltos (1 atrás do Traefik do Dokploy) e substitui a cadeia recebida pelo endereço do cliente que resolveu. Não exponha a porta do ms-identity diretamente com `IDENTITY_TRUST_PROXY` maior que 0.

Tokens RS256 duram 300 segundos e incluem sub, organizationId, role, teamIds, projectIds, assignableUserIds, assignableTeamIds e source (`api` ou `ui`), derivados do banco. O campo Authorization é limitado a 7000 bytes na emissão; excesso retorna 422, sem truncar permissões ou referências. Assim, organizações com cerca de 120–130 UUIDs totais nas claims podem atingir o teto; o número exato depende de duplicações e payload. Isso é uma limitação funcional que exige evolução do contrato de autorização para organizações maiores. O serviço de projetos não introspecta tokens: desativação, troca de senha, mudança de papel ou vínculos pode levar até cinco minutos para refletir em ms-projects. No próprio ms-identity, papel e estado são revalidados em toda chamada; trocar senha não invalida imediatamente tokens válidos. Para incidentes que exijam invalidação imediata em outros serviços, é necessário invalidar a chave de assinatura nos verificadores ou implementar introspecção/revogação distribuída.

A migration 002 exige troca de senha das contas existentes, inclusive administradores criados antes dela; numa instala??o nova, a senha fornecida no bootstrap ? definitiva. Senhas usam scrypt com salt aleatório e comparação constante. Cinco falhas por conta, somadas entre login e confirma??o de senha atual na troca de senha, causam bloqueio de 15 minutos persistido no banco para ambas as opera??es; adicionalmente, há limite de 20 logins por minuto por cliente por processo (ver "Endereço do cliente"). Implantações com múltiplas réplicas precisam de rate limiting compartilhado no ingresso. Use TLS no ingresso, controle de acesso aos segredos e comunicação protegida com o banco. Não há redefinição de senha por e-mail, MFA ou recuperação de conta nesta entrega.

Alterações de organização, membro, equipe e vínculos escrevem eventos locais em `identity.outbox_events` na mesma transação, via triggers. Não há relay, consumidores ou contrato de evento externo: registros pendentes não significam entrega. O conteúdo não inclui hash de senha; alterações de credencial e contadores de login não geram eventos. Políticas de publicação e retenção ainda precisam ser definidas antes da integração.

## OAuth 2.1 para clientes MCP

O serviço também é o servidor de autorização OAuth 2.1 do MCP do Kairos. O usuário cola só a URL do MCP (`https://api.kairos.noxlabs.tech/mcp`) no cliente e faz login numa página do Kairos; o cliente descobre o resto sozinho:

1. `POST /mcp` sem token responde 401 com `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"` (servido pelo mcp-server).
2. Esse documento (RFC 9728) aponta `authorization_servers: [IDENTITY_ISSUER]`.
3. O cliente lê os metadados RFC 8414 do emissor, registra-se (RFC 7591), abre a página de login e troca o código por tokens.

Endpoints, todos relativos a `IDENTITY_ISSUER` (`https://api.kairos.noxlabs.tech/identity` em produção) e fora do prefixo `/api/v1`:

| Método e caminho | Função |
| --- | --- |
| `GET /.well-known/oauth-authorization-server/identity` | metadados RFC 8414 (o mesmo documento também em `/.well-known/openid-configuration/identity`, `/identity/.well-known/oauth-authorization-server` e `/identity/.well-known/openid-configuration`) |
| `GET /identity/.well-known/jwks.json` | chave pública RS256 dos tokens |
| `POST /identity/oauth/register` | registro dinâmico de cliente público (JSON) |
| `GET /identity/oauth/authorize` | página de login e consentimento |
| `POST /identity/oauth/authorize` | envio do formulário (`application/x-www-form-urlencoded`) |
| `POST /identity/oauth/token` | `authorization_code` e `refresh_token` (`application/x-www-form-urlencoded`) |
| `POST /identity/oauth/revoke` | revogação de refresh token (RFC 7009) |

Regras:

- Só clientes públicos (`token_endpoint_auth_method: none`) com PKCE S256. Um pedido de método com segredo é substituído por `none` na resposta do registro. `redirect_uris`: 1 a 10, HTTPS em qualquer host, HTTP só em `localhost`, `127.0.0.1` ou `[::1]` (a porta pode variar na autorização, RFC 8252 §7.3), esquemas privados em forma de domínio reverso (`com.exemplo.app:`) e `cursor://`. Fragmentos, credenciais na URL, `javascript:`, `data:` e `file:` são recusados.
- A autorização exige `response_type=code`, `code_challenge_method=S256` e, quando enviado, `resource` igual a `IDENTITY_OAUTH_RESOURCE` (RFC 8707). Cliente desconhecido ou `redirect_uri` não registrado mostram erro na página e não redirecionam; os demais erros voltam ao cliente com `error`, `state` e `iss` (RFC 9207). Escopos: `projects:read` e `projects:write`; escopos desconhecidos são ignorados e, sem nenhum conhecido, os dois são concedidos.
- A página (português, tema claro/escuro, sem recursos externos, `frame-ancestors 'none'`) mostra o nome do app informado no registro, o host de retorno e os escopos. O login reaproveita o BetterAuth (a sessão de navegador que ele abre é apagada em seguida) e o limite de 20 tentativas por minuto por IP, numa conta separada (`oauth-login`). O formulário usa cookie CSRF `kairos_oauth_csrf` (HttpOnly, SameSite=Strict, Secure quando o emissor é HTTPS) comparado com campo oculto, e recusa `Sec-Fetch-Site` de outro site. "Permitir acesso" é o consentimento; "Cancelar" devolve `access_denied`. Conta com senha provisória é recusada com orientação para trocar a senha no Workspace. Conta em várias organizações escolhe a organização depois da senha, com um tíquete assinado de 5 minutos vinculado ao cookie e ao pedido.
- Código de autorização: aleatório de 256 bits, guardado só como hash SHA-256, uso único, 120 segundos, vinculado a cliente, `redirect_uri`, desafio PKCE, escopo, recurso e organização. Reapresentar um código usado revoga os refresh tokens que ele gerou.
- Access token: o mesmo snapshot de `auth/login` (organização, papel atuais, equipes, projetos), `source=mcp`, `scope`, `client_id`, `aud` = [`IDENTITY_AUDIENCE`, `IDENTITY_OAUTH_RESOURCE`] e validade de 1 hora. O ms-projects o aceita quando o mcp-server o repassa; as rotas do próprio ms-identity recusam tokens com `scope`/`client_id`.
- Refresh token: opaco, hash SHA-256, 30 dias a partir de cada emissão, rotação a cada uso. Reuso de um token já trocado revoga a família inteira. Cada refresh relê membro, organização e papel: membro desativado, organização inativa ou senha provisória revogam a família.
- Tabelas da migration `004_oauth`: `identity.oauth_clients`, `identity.oauth_authorization_codes`, `identity.oauth_refresh_tokens`. Linhas expiradas há mais de um dia são apagadas a cada novo código.

Configuração: `IDENTITY_OAUTH_RESOURCE` é a URL pública do MCP (padrão `http://localhost:3006/mcp`; produção `https://api.<PUBLIC_HOST>/mcp`) e deve ser igual a `MCP_RESOURCE` do mcp-server. O OAuth só é habilitado quando `IDENTITY_ISSUER` é uma origem seguida de `/identity`, porque as rotas acima ficam nesse caminho; com outro valor o serviço sobe sem essas rotas e registra um aviso na inicialização. O tíquete de organização usa uma chave derivada de `BETTER_AUTH_SECRET`.

### Conectar um cliente

- **Claude (web e Desktop):** Configurações → Conectores → Adicionar conector personalizado → URL `https://api.kairos.noxlabs.tech/mcp` → Conectar e entrar com e-mail e senha do Kairos. Em planos Team/Enterprise, um proprietário adiciona o conector nas configurações da organização. O Claude Desktop usa os conectores da conta.
- **Claude Code:** `claude mcp add --transport http kairos https://api.kairos.noxlabs.tech/mcp`; depois, dentro do Claude Code, `/mcp` → `kairos` → Authenticate. O navegador abre a página de login e devolve para `http://localhost:<porta>/callback`.
- **ChatGPT:** Configurações → Apps e conectores → Configurações avançadas → ativar o modo desenvolvedor; depois criar um conector com a URL do MCP e autenticação OAuth. Disponibilidade depende do plano.
- **Cursor:** em `~/.cursor/mcp.json` (ou `.cursor/mcp.json` do projeto), `{"mcpServers":{"kairos":{"url":"https://api.kairos.noxlabs.tech/mcp"}}}`; em Settings → MCP, clique em Login/Connect no servidor `kairos`.

Os menus dos clientes mudam com frequência; o que não muda é a URL e o login do Kairos. Para desconectar, remova o conector no cliente; um administrador também pode desativar o membro, o que impede o próximo refresh (o access token em uso vale até 1 hora).

## Verificação

`pnpm --filter @axial/ms-identity typecheck`, `build` e `test:unit`. `test:integration` exige `IDENTITY_TEST_DATABASE_URL` cujo nome termine em `_test` (por exemplo `postgresql://axial:axial_local_only@localhost:5550/axial_test`, do `docker compose up -d`) com permissão CREATEDB; cada suíte cria um banco descartável `*_test` e o remove no fim. `test/integration.mjs` exercita migration, bootstrap, login, troca de senha, revogação administrativa, outbox e rejeição de token grande; `test/oauth-integration.mjs` exercita metadados, registro dinâmico, página de login/CSRF, código + PKCE, verificador errado, reuso de código, `redirect_uri` divergente, código expirado, rotação e reuso de refresh token, revogação, múltiplas organizações, membro desativado e limite de tentativas (inclusive `X-Forwarded-For` ignorado sem proxy confiável); `test/accounts-integration.mjs` exercita limite por cliente atrás de um proxy confiável (entradas forjadas não contam), login sem organização (um, vários e nenhum vínculo), cookie de sessão (flags, troca, logout), CORS com credenciais só para a origem do Workspace, `source` `ui`/`api`, signup (senha curta, e-mail existente com senha errada e certa), `GET me`, convites (criação, hash, prévia, aceitação nova e por conta existente com senha errada e certa, reuso, revogação, expiração, listagem, permissões, limite) e o diretório da organização. `test/integration.mjs` também confere o signup desligado. Não aponte para banco com dados necessários.

Migration `005_profiles_invitations`: `members.title` (até 120 caracteres), `teams.description` (até 1000), `teams.lead_user_id` (chave composta com a organização, então só aponta para membro da mesma empresa) e `identity.invitations`. O readiness exige as cinco migrations.
