FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates chromium fonts-noto-core fonts-noto-extra && rm -rf /var/lib/apt/lists/*
ENV TOROB_CHROME_PATH=/usr/bin/chromium TOROB_BROWSER_NO_SANDBOX=true
WORKDIR /app
FROM base AS dependencies
COPY package*.json ./
RUN npm ci
FROM dependencies AS build
COPY prisma ./prisma
RUN DATABASE_URL=postgresql://schema:schema@localhost:5432/schema npx prisma generate
COPY src ./src
COPY scripts ./scripts
COPY test ./test
FROM build AS test
RUN npm test
FROM build AS integration
CMD ["sh", "-c", "npx prisma migrate deploy && node --test test/integration.test.js test/market-integration.test.js test/hall-integration.test.js"]
FROM build AS production
RUN npm prune --omit=dev --ignore-scripts
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
