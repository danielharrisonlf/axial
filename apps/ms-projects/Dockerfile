FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/ms-projects/package.json apps/ms-projects/package.json
RUN pnpm install --frozen-lockfile
COPY packages/contracts packages/contracts
COPY apps/ms-projects apps/ms-projects
RUN pnpm build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/ms-projects
EXPOSE 3001
CMD ["node", "dist/main.js"]
