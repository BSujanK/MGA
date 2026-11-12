# MGA web (Next.js standalone). Build context: frontend/
#   docker build -t mga-web --build-arg MGA_API_URL=http://api:8000 frontend
# MGA_API_URL is where the Next.js server proxies /api/*. It is baked into the
# build (rewrites are resolved at build time) and also set at runtime.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ARG MGA_API_URL=http://localhost:8000
ENV MGA_API_URL=$MGA_API_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build

FROM node:22-alpine AS run
WORKDIR /app
ARG MGA_API_URL=http://localhost:8000
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    MGA_API_URL=$MGA_API_URL \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup -S -g 10001 nodejs && adduser -S -u 10001 -G nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["node", "server.js"]
