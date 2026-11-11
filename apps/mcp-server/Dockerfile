FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/mcp-server/package.json apps/mcp-server/package.json
RUN pnpm install --frozen-lockfile
COPY apps/mcp-server/tsconfig*.json apps/mcp-server/
COPY apps/mcp-server/src apps/mcp-server/src
RUN pnpm --filter @axial/mcp-server build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/mcp-server/package.json ./apps/mcp-server/package.json
COPY --from=build --chown=node:node /app/apps/mcp-server/node_modules ./apps/mcp-server/node_modules
COPY --from=build --chown=node:node /app/apps/mcp-server/dist ./apps/mcp-server/dist
USER node
WORKDIR /app/apps/mcp-server
EXPOSE 3006
CMD ["node", "dist/main.js"]
