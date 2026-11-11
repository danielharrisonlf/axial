FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/ms-audit/package.json apps/ms-audit/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY packages/contracts packages/contracts
COPY apps/ms-audit/tsconfig*.json apps/ms-audit/
COPY apps/ms-audit/src apps/ms-audit/src
RUN pnpm --filter @axial/contracts build && pnpm --filter @axial/ms-audit build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/contracts ./packages/contracts
COPY --from=build --chown=node:node /app/apps/ms-audit/package.json ./apps/ms-audit/package.json
COPY --from=build --chown=node:node /app/apps/ms-audit/node_modules ./apps/ms-audit/node_modules
COPY --from=build --chown=node:node /app/apps/ms-audit/dist ./apps/ms-audit/dist
COPY --chown=node:node apps/ms-audit/migrations ./apps/ms-audit/migrations
USER node
WORKDIR /app/apps/ms-audit
EXPOSE 3005
CMD ["node", "dist/main.js"]
