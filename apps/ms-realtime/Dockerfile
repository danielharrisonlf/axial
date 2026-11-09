FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/ms-realtime/package.json apps/ms-realtime/package.json
RUN pnpm install --frozen-lockfile
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY apps/ms-realtime/tsconfig*.json apps/ms-realtime/
COPY apps/ms-realtime/src apps/ms-realtime/src
RUN pnpm --filter @axial/contracts build && pnpm --filter @axial/ms-realtime build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/apps/ms-realtime/package.json ./apps/ms-realtime/package.json
COPY --from=build --chown=node:node /app/apps/ms-realtime/node_modules ./apps/ms-realtime/node_modules
COPY --from=build --chown=node:node /app/apps/ms-realtime/dist ./apps/ms-realtime/dist
USER node
WORKDIR /app/apps/ms-realtime
EXPOSE 3004
CMD ["node", "dist/main.js"]
