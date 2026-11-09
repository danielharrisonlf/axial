FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/ms-notifications/package.json apps/ms-notifications/package.json
RUN pnpm install --frozen-lockfile
COPY apps/ms-notifications/tsconfig*.json apps/ms-notifications/
COPY apps/ms-notifications/src apps/ms-notifications/src
RUN pnpm --filter @axial/ms-notifications build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/ms-notifications/package.json ./apps/ms-notifications/package.json
COPY --from=build --chown=node:node /app/apps/ms-notifications/node_modules ./apps/ms-notifications/node_modules
COPY --from=build --chown=node:node /app/apps/ms-notifications/dist ./apps/ms-notifications/dist
COPY --chown=node:node apps/ms-notifications/migrations ./apps/ms-notifications/migrations
USER node
WORKDIR /app/apps/ms-notifications
EXPOSE 3003
CMD ["node", "dist/main.js"]
