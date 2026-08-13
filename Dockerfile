# ─── Stage 1: Dependencies ───
FROM node:20-slim AS deps
RUN apt-get update && apt-get install -y openssl sqlite3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN npm install --production=false 2>/dev/null || true

# ─── Stage 2: Build ───
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npx next build

# ─── Stage 3: Production ───
FROM node:20-slim AS runner
RUN apt-get update && apt-get install -y sqlite3 tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL="file:/app/data/gateway.db"

RUN addgroup --system --gid 1001 gateway && adduser --system --uid 1001 gateway

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

RUN mkdir -p /app/data && chown gateway:gateway /app/data

USER gateway

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/stats || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
