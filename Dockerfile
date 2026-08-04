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
ENV MINIFLARE_REGISTRY_PATH=.wrangler/registry

RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV WRANGLER_LOG_PATH=.wrangler/wrangler.log
ENV WRANGLER_WRITE_LOGS=false

# vinext is a devDependency but required by `npm run start`
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["npm", "run", "start"]
