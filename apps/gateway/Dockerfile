FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY packages/observability/package.json packages/observability/package.json
RUN pnpm install --frozen-lockfile
COPY packages/observability packages/observability
RUN pnpm --filter @axial/observability build
COPY apps/gateway/tsconfig*.json apps/gateway/
COPY apps/gateway/src apps/gateway/src
RUN pnpm --filter @axial/gateway build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/gateway/package.json ./apps/gateway/package.json
COPY --from=build --chown=node:node /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=build --chown=node:node /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=build --chown=node:node /app/packages/observability/package.json ./packages/observability/package.json
COPY --from=build --chown=node:node /app/packages/observability/dist ./packages/observability/dist
USER node
WORKDIR /app/apps/gateway
EXPOSE 3000
CMD ["node", "dist/main.js"]
