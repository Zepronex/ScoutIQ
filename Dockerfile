# syntax=docker/dockerfile:1
# One image runs the whole public service: the Express API and the built web app.
# The data refresh (Node + Python) runs elsewhere and only needs DATABASE_URL.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY apps ./apps
RUN pnpm run build

FROM base AS deps
RUN pnpm install --frozen-lockfile --prod --filter @fpl-optimizer/api

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3001 \
    SCOUTIQ_DATA_MODE=fpl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY db ./db
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
# Apply any new migrations, then hand the process over to the server so it
# receives SIGTERM directly and can finish open requests.
CMD ["sh", "-c", "node apps/api/dist/db/migrate.js && exec node apps/api/dist/index.js"]
