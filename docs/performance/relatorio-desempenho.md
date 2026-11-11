# Análise de desempenho — 2ª entrega

**Projeto:** ProjectFlow / Axial — plataforma interna de gestão de projetos
**Data:** 11/11/2026
**Escopo:** front-end React/Vue, APIs NestJS, gateway e comportamento sob carga
**Ambiente local:** Windows, Node.js 24.21, PostgreSQL 16 e Redis 7 em Docker, Chromium do Playwright

## 1. Objetivo e método

A análise seguiu o Guia de Análise de Desempenho: medir o front-end com Lighthouse e DevTools, testar as APIs com carga, identificar gargalos, aplicar melhorias e registrar evidências.

O sistema não precisava estar completo. Foram usadas as funcionalidades já implementadas: Workspace (dashboard, projetos, Insights) e os serviços `ms-projects`, `ms-identity`, `ms-audit`, `ms-notifications`, `ms-realtime`, `gateway` e `mcp-server`.

Método:

1. **Baseline**: stack completa no ar, banco migrado e populado, Lighthouse (desktop e mobile) e carga com `autocannon`.
2. **Diagnóstico**: leitura dos relatórios, DevTools/Performance, rede e código do caminho crítico.
3. **Correções**: aplicadas no gateway, APIs e front-end.
4. **Remedição**: mesmos cenários, comparação antes/depois e A/B controlado para o gateway.
5. **Evidências**: relatórios JSON/HTML, capturas e scripts reprodutíveis em `docs/performance/evidencias` e `output/validation/performance`.

Ferramentas: Lighthouse 12, `autocannon` 9, Playwright/Chromium (PerformanceObserver + CDP `Performance.getMetrics`), `curl` e `EXPLAIN`/índices do PostgreSQL.

## 2. Front-end

### 2.1 Lighthouse — antes e depois

| Cenário | Perf. antes | Perf. depois | LCP antes | LCP depois | TBT antes | TBT depois | SI antes | SI depois |
|---|---|---|---|---|---|---|---|---|
| Desktop (dashboard) | 0,99 | **1,00** | 0,6 s | **0,2–0,7 s** | 0 ms | **0 ms** | 1,0 s | **0,4–0,5 s** |
| Mobile (dashboard) | 0,92 | **1,00**¹ | 1,6 s | **0,9 s**¹ | 250 ms | **60 ms** | 4,0 s | **0,9–1,0 s** |

¹ Mediana de 5 execuções mobile: 1,00, 1,00, 1,00, 1,00 e 0,93. A execução outlier teve LCP 3,1 s e TBT 140 ms por contenção de CPU/Lantern; as demais ficaram em LCP 0,9 s. Como a simulação do Lighthouse varia entre execuções, o HTML anexado pode registrar 0,94 e LCP 3,0 s; o valor de referência é a mediana. A série completa está em `resultados.json` (`lighthouseMobileRuns`).

Acessibilidade 0,95, Boas Práticas 1,00 e SEO 0,91 em ambos os perfis. CLS 0.

Peso total da página: **1.159 KiB → 287 KiB** (−75%).

### 2.2 DevTools / Web Vitals (após as correções)

Coletado com Chromium via Playwright, cache limpo, sem throttling, viewport desktop 1440×1000 e mobile 390×844 (DPR 3).

| Página | Perfil | LCP | CLS | Long tasks | DCL | Transferido | JS transferido |
|---|---|---|---|---|---|---|---|
| Dashboard | desktop | 768 ms | 0 | 0 | 34 ms | 263 KB | 158 KB |
| Dashboard | mobile | 416 ms | 0 | 0 | 15 ms | 263 KB | 158 KB |
| Projetos | desktop | 708 ms | 0 | 0 | 15 ms | 282 KB | 162 KB |
| Projetos | mobile | 700 ms | 0 | 0 | 16 ms | 282 KB | 162 KB |

O baseline desktop da primeira coleta tinha `DOMContentLoaded` de ~3,2 s por causa do Google Fonts bloqueando a renderização; o valor caiu para ~34 ms com as fontes locais.

### 2.3 Gargalos e correções

| Gargalo | Evidência | Correção | Resultado |
|---|---|---|---|
| Google Fonts bloqueando a renderização | Lighthouse: `render-blocking-insight` estimava 780 ms; DCL de 3,2 s | Fontes IBM Plex self-hosted via `@fontsource` + `font-display: optional` | Render-blocking caiu para ~300 ms (só o CSS local); DCL ~34 ms |
| Bundle único de 500 KB | `index-*.js` 500,2 KB (133,9 KB gzip); Lighthouse apontava 254 KiB de JS não usado | Code splitting por rota com `React.lazy`/`Suspense`; dashboard mantido estático por ser a rota inicial | Entrada principal 236 KB (71,8 KB gzip); páginas em chunks de 3–14 KB |
| Remote do Insights baixado no boot | `<link rel="modulepreload" href="http://localhost:5174/remoteEntry.js">` no HTML | Plugin Vite remove o modulepreload cross-origin; remote só é carregado ao abrir Insights | −168 KB no primeiro paint do Workspace |
| Fontes trocando após o paint | LCP mobile estimado em 3,2 s em uma execução | `font-display: optional` + self-host | LCP mobile 0,9 s na mediana |

Trade-off das fontes: na primeira visita em rede lenta o texto usa a fonte de sistema; o IBM Plex entra quando já está em cache. Em desktop/rede rápida a fonte é aplicada na primeira pintura.

### 2.4 Evidências de front-end

- `docs/performance/evidencias/lighthouse-desktop.report.html`
- `docs/performance/evidencias/lighthouse-mobile.report.html`
- `docs/performance/evidencias/vitals.json`
- `docs/performance/evidencias/graficos.html`

## 3. APIs e gateway

### 3.1 Carga — antes e depois

`autocannon`, conexões keep-alive, 10 s por cenário (5 s no login), sem pipelining. Token RS256 de ADMIN com organização do seed. Valores de latência em ms.

| Cenário | Antes: req/s | Antes: p50 | Antes: p99 | Depois: req/s | Depois: p50 | Depois: p99 | Erros antes → depois |
|---|---|---|---|---|---|---|---|
| `GET /health/live` (gateway) | 3.565 | 24 | 81 | **8.883** | **10** | **26** | 0 → 0 |
| `GET /health/live` (API) | 3.443 | 25 | 107 | **11.121** | **8** | **24** | 0 → 0 |
| `GET /projects` (API) | 850 | 55 | 100 | **1.853** | **25** | **40** | 0 → 0 |
| `GET /projects` (gateway) | 617 | 2.475 | 4.727 | **1.755** | **27** | **45** | 10 → 0 |
| `GET /projects/:id/tasks` (API) | 525 | 93 | 145 | **1.139** | **42** | **57** | 0 → 0 |
| `GET /audit` (gateway) | 596 | 2.470 | 4.764 | **2.016** | **10** | **179** | 8 → 0 |
| `GET /notification-preferences` (gateway) | 823 | 2.478 | 4.854 | **2.442** | **6** | **289** | 47 → 0 |

Observação 1: a coluna “antes” foi coletada antes da limpeza dos processos remanescentes e reflete o gateway com `agent: false`. Para isolar o efeito do proxy, foi feito o A/B controlado abaixo, na mesma máquina e com o restante do código idêntico.

Observação 2: a vazão absoluta varia com a carga da máquina (Lighthouse/Chromium, antivírus, outros processos). A tabela usa a coleta comparativa `loadBefore`/`loadAfter` de `resultados.json`; a chave `load` guarda a última execução do pipeline `pnpm perf`, que pode apresentar números menores sob contenção.

### 3.2 A/B controlado do gateway

O `http-proxy` usa `agent: false` por padrão, abrindo uma conexão TCP por requisição. O A/B manteve o mesmo código e alternou apenas o pool keep-alive.

| Cenário | req/s | p50 (ms) | p99 (ms) | Erros |
|---|---|---|---|---|
| `GET /projects` sem keep-alive | 1.309 | 1.922 | 3.906 | 35 |
| `GET /projects` com keep-alive | **1.755** | **27** | **45** | **0** |
| `GET /audit` sem keep-alive | 1.402 | 1.969 | 3.960 | 63 |
| `GET /audit` com keep-alive | **2.016** | **10** | **179** | **0** |

Ganho de ~34% na vazão e remoção dos erros de conexão; a latência mediana caiu de ~1,9 s para dezenas de milissegundos.

### 3.3 Compressão de payloads

`compression` com limiar de 1 KB no gateway e em `ms-projects`, `ms-audit` e `ms-notifications`.

| Resposta | Sem compressão | gzip | Redução |
|---|---|---|---|
| Auditoria, 50 registros | 6.399 B | 1.325 B | **79%** |
| Tarefas, 20 registros | 1.705 B | 605 B | **65%** |

### 3.4 Login (scrypt + rate limit)

- 10 logins sequenciais válidos: **p50 69 ms**, mínimo 61 ms, máximo 374 ms. O custo é dominado pelo `scrypt` do BetterAuth.
- 30 tentativas rápidas do mesmo IP: **10 × 201** e **20 × 429**. O limite é 20 logins/min por IP, por processo. É comportamento intencional de segurança, mas limita testes de carga no login; por isso a carga de login não entra na tabela de vazão.

### 3.5 Banco de dados

As consultas de listagem usam índices compostos existentes (`organizationId`, `projectId`, `status`, `createdAt`). O `GET /projects/:id/tasks` ficou em 42 ms p50 (1.139 req/s) contra 25 ms do `GET /projects`; a diferença é o maior payload e a montagem das relações, não falta de índice. O `audit` sustenta 2.016 req/s pelo gateway com gzip.

## 4. Gargalos remanescentes e próximos passos

1. **Gateway limita a vazão de proxiados** (~1,7–2,4k req/s) quando comparado ao acesso direto (1,8–11k). Para escala horizontal, avaliar cluster do Node, HTTP/2 nos upstreams ou um proxy nativo. Para o volume acadêmico atual, está adequado.
2. **Login é CPU-bound** (~69 ms por scrypt). Alternativas: ajustar o custo do `scrypt` dentro do recomendado, mover o hash para worker threads ou manter o rate limit como proteção. Não foi alterado por ser decisão de segurança.
3. **Cache de assets**: o preview do Vite responde `Cache-Control: no-cache`. Em produção, configurar `immutable, max-age=31536000` para `/assets/*` (nomes com hash) e `no-cache` apenas para o HTML.
4. **Lighthouse mobile tem variância** alta no modo simulado. A mediana foi 1,00; repetir 3–5 vezes é o procedimento adotado.
5. **Testes de carga autenticados** dependem de token de 15 min. O script regenera o token antes da execução; tokens expirados retornam 401 e invalidam a medição.

## 5. Observabilidade e demonstração ao vivo

Para a apresentação, a análise ganhou instrumentação nos próprios serviços e um painel local que repete as medições ao vivo.

### 5.1 Métricas nativas nos serviços NestJS

O pacote `packages/observability` (`@axial/observability`) é registrado como middleware no gateway e no ms-projects. Cada requisição entra em um histograma de latência com buckets fixos, de 1 ms a 10 s: o registro é O(1) e a memória fica constante, seja qual for o volume. Uma janela deslizante de 60 s guarda os dados por segundo.

| Endpoint | Conteúdo |
|---|---|
| `GET /api/v1/metrics` | JSON: vazão, p50/p95/p99, taxa de erro, requisições em andamento, rotas mais acessadas, série dos últimos 60 s, CPU, heap/RSS, uso e atraso do event loop |
| `GET /api/v1/metrics/prometheus` | Formato de exposição Prometheus (contadores, histograma `http_request_duration_ms` e gauges de runtime) |

O atraso do event loop é medido com `setImmediate`, e não com `monitorEventLoopDelay`. A API nativa depende de timers, e a resolução de ~15,6 ms dos timers no Windows aparecia como atraso mesmo com o processo ocioso. Com `NODE_ENV=production`, os endpoints só respondem com `METRICS_TOKEN`.

### 5.2 NestJS Observe

O ms-projects importa o `@nestjs/observe` (SDK oficial de APM lançado com o NestJS 12). Ele gera traces por classe e método (guard → controller → service → query `pg`), agrupa erros e declara SLOs. O SDK só envia dados para o painel hospedado em observe.nestjs.com e exige credenciais. Por isso fica **desligado por padrão** e liga apenas com `OBSERVE_APP_KEY` e `OBSERVE_APP_SECRET`. Assim, as medições deste relatório não incluem o overhead do agente.

### 5.3 Painel ao vivo (`pnpm perf:demo`)

O painel roda em `http://127.0.0.1:4900`. Ele dispara o `autocannon` programaticamente e transmite, segundo a segundo, a vazão e as latências medidas pelo cliente, junto com as métricas que os serviços registram. Também refaz o A/B do gateway subindo uma segunda instância com `GATEWAY_UPSTREAM_KEEPALIVE=false` na porta 3100.

Execução do A/B pelo painel em 11/11/2026 (GET /projects via gateway, 50 conexões, 10 s por lado, mesma máquina, com a stack recém-iniciada):

| Gateway | req/s | p50 (ms) | p99 (ms) | Erros |
|---|---|---|---|---|
| Sem keep-alive | 497 | 2.509 | 4.378 | 467 |
| Com keep-alive | **681** | **68** | **127** | **0** |

A vazão absoluta ficou abaixo da coleta da seção 3 porque a máquina dividia CPU com outros processos. O padrão, porém, se repete: sem o pool, a latência mediana sobe para segundos e surgem erros de conexão. Com ele, a latência cai para dezenas de milissegundos, sem erros.

Lighthouse desktop executado pelo painel na mesma sessão: Performance 100, FCP/LCP 0,2 s, TBT 0 ms, CLS 0, peso total 287 KiB.

## 6. Como reproduzir

A camada de desempenho está automatizada em `scripts/performance/run.mjs`.

**Tudo em um comando** (infra, migrations, build, stack, carga, Web Vitals, Lighthouse e consolidação):

```bash
pnpm perf
```

O comando sobe o Docker, aplica migrations/seed, compila o monorepo, inicia os nove processos, gera o token, executa os cenários de carga, coleta Web Vitals, roda Lighthouse desktop/mobile, grava `docs/performance/resultados.json` e encerra a stack. Use `PERF_KEEP_STACK=1` para mantê-la no ar e `PERF_SKIP_INFRA=1` quando o Docker já estiver pronto.

**Comandos parciais**, quando a stack já está no ar:

```bash
pnpm perf:stack        # inicia API, identidade, notificações, realtime, audit, MCP, gateway, web e Insights
pnpm perf:load         # gera o token e roda os cenários de autocannon
pnpm perf:web          # Web Vitals/DevTools via Playwright
pnpm perf:lighthouse   # Lighthouse desktop e mobile + cópia das evidências
pnpm perf:report       # consolida os resultados em docs/performance/resultados.json
pnpm perf:stop         # encerra os processos iniciados
pnpm perf:demo         # painel local de desempenho ao vivo (porta 4900)
```

Dependências fixadas na raiz: `autocannon@9.0.0` e `lighthouse@13.6.0`. O Chromium é localizado automaticamente em `%LOCALAPPDATA%\ms-playwright` ou via `CHROME_PATH`. Para medir login, defina `PERF_LOGIN_EMAIL`, `PERF_LOGIN_PASSWORD` e `PERF_LOGIN_ORG`; sem isso o cenário é omitido.

## 7. Índice de evidências

| Arquivo | Conteúdo |
|---|---|
| `docs/performance/resultados.json` | Consolidação numérica (carga, Lighthouse, Web Vitals, payloads, login) |
| `docs/performance/evidencias/lighthouse-desktop.report.html` | Relatório Lighthouse desktop |
| `docs/performance/evidencias/lighthouse-mobile.report.html` | Relatório Lighthouse mobile |
| `docs/performance/evidencias/vitals.json` | Web Vitals e métricas CDP das quatro combinações |
| `docs/performance/evidencias/graficos.html` | Gráficos antes/depois e A/B do gateway |
| `docs/performance/evidencias/load/` | JSONs brutos do `autocannon` (final e A/B) |
| `output/validation/performance/` | Logs, relatórios completos, scripts e capturas geradas |
