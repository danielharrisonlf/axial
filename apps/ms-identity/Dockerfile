FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/ms-identity/package.json apps/ms-identity/package.json
RUN pnpm install --frozen-lockfile
COPY apps/ms-identity/tsconfig*.json apps/ms-identity/
COPY apps/ms-identity/src apps/ms-identity/src
RUN pnpm --filter @axial/ms-identity build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/ms-identity/package.json ./apps/ms-identity/package.json
COPY --from=build --chown=node:node /app/apps/ms-identity/node_modules ./apps/ms-identity/node_modules
COPY --from=build --chown=node:node /app/apps/ms-identity/dist ./apps/ms-identity/dist
COPY --chown=node:node apps/ms-identity/migrations ./apps/ms-identity/migrations
USER node
WORKDIR /app/apps/ms-identity
EXPOSE 3002
CMD ["node", "dist/main.js"]
