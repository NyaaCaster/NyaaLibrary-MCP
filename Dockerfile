# ---- Stage 1: build frontend (Vite → static assets) ----
FROM node:20-slim AS frontend
WORKDIR /app/frontend
# maxsockets=1 forces serial downloads: Docker Desktop networking can stall on
# concurrent large native-binary fetches (rollup/esbuild/@tailwindcss/oxide).
ENV npm_config_maxsockets=1 npm_config_fetch_timeout=600000
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: build server (TypeScript → dist) ----
# Debian slim (glibc) is used so better-sqlite3 and the sqlite-vec loadable
# extension resolve their prebuilt binaries reliably; build tools are present
# as a compile fallback for better-sqlite3.
FROM node:20-slim AS server
WORKDIR /app/server
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY server/package.json ./
RUN npm install
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ---- Stage 3: runtime ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    APP_PORT=5101 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    TZ=Asia/Shanghai

# Persisted data dir (SQLite DB + vector store); writable by the node user.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

COPY --chown=node:node --from=server /app/server/node_modules ./node_modules
COPY --chown=node:node --from=server /app/server/dist ./dist
COPY --chown=node:node --from=server /app/server/package.json ./package.json
COPY --chown=node:node --from=frontend /app/frontend/dist ./public

EXPOSE 5101
CMD ["node", "dist/index.js"]
