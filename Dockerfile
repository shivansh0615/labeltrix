# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV WRANGLER_LOG_PATH=.wrangler/wrangler.log
ENV WRANGLER_WRITE_LOGS=false
ENV WRANGLER_SEND_METRICS=false
ENV MINIFLARE_REGISTRY_PATH=.wrangler/registry

RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV WRANGLER_LOG_PATH=.wrangler/wrangler.log
ENV WRANGLER_WRITE_LOGS=false
ENV WRANGLER_SEND_METRICS=false
ENV MINIFLARE_REGISTRY_PATH=.wrangler/registry

# Cloudflare Workers runtime (vite preview / workerd) needs config + build output
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/.wrangler/deploy ./.wrangler/deploy
COPY --from=builder /app/vite.config.ts ./vite.config.ts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/build ./build
COPY --from=builder /app/.openai ./.openai
COPY --from=builder /app/scripts/start.mjs ./scripts/start.mjs

EXPOSE 3000

CMD ["npm", "run", "start"]
