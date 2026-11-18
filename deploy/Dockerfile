# syntax=docker/dockerfile:1.7
# Axial em produção (Dokploy): um único build do monorepo, três imagens finais.
#   backend  -> os sete serviços NestJS (o comando escolhe o serviço; ver deploy/compose.yaml)
#   web      -> Workspace (React) estático em nginx
#   insights -> microfrontend Insights (Vue) estático em nginx, com CORS para o Module Federation
# Contexto de build: raiz do repositório.

FROM node:24-alpine AS base
ENV CI=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    COREPACK_HOME=/usr/local/share/corepack \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable \
 && corepack prepare pnpm@10.11.1 --activate \
 && chmod -R a+rX /usr/local/share/corepack
WORKDIR /app

# --- dependências: baixadas só a partir do lockfile (camada reaproveitada entre deploys) ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=axial-pnpm,target=/pnpm/store pnpm fetch

# --- build de todo o monorepo, uma vez ---
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=axial-pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile
# endereço público do remote do Insights, embutido no build do Workspace
ARG INSIGHTS_REMOTE_ENTRY=http://localhost:5174/remoteEntry.js
ENV INSIGHTS_REMOTE_ENTRY=$INSIGHTS_REMOTE_ENTRY
# origem pública do gateway, embutida no build do Workspace (modo API: login real e dados dos serviços);
# vazio = mesma origem (só faz sentido com um proxy /api na frente do nginx do Workspace)
ARG VITE_API_BASE_URL=https://api.kairos.noxlabs.tech
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# o build de produção é sempre "api"; "demo" existe só para pnpm dev:web e o e2e legado
ENV VITE_WORKSPACE_SOURCE=api
# 2 tarefas em paralelo: cabe com folga numa VPS de 2 vCPUs
RUN pnpm turbo run build --concurrency=2

# --- serviços NestJS ---
FROM base AS backend
COPY --from=build --chown=node:node /app /app
# chaves de identidade ficam num volume (gerado no primeiro deploy, nunca na imagem)
RUN mkdir -p /app/keys && chown node:node /app/keys && chmod +x /app/deploy/setup.sh
USER node
ENV NODE_ENV=development
CMD ["node", "--version"]

# --- Workspace (React) ---
FROM nginx:1.27-alpine AS web
COPY deploy/nginx/security-headers.inc /etc/nginx/snippets/security-headers.inc
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# --- Insights (Vue, remote do Module Federation) ---
FROM nginx:1.27-alpine AS insights
COPY deploy/nginx/security-headers.inc /etc/nginx/snippets/security-headers.inc
COPY deploy/nginx/insights.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/insights/dist /usr/share/nginx/html
