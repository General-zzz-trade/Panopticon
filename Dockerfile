# ---- Builder stage ----
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

RUN npm run build

# ---- Runner stage ----
FROM node:22-slim AS runner

# Install Playwright Chromium dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libx11-6 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libwayland-client0 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright Chromium
RUN npx playwright install chromium

# Copy built output and public assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Create artifacts directory for SQLite
RUN mkdir -p /app/artifacts && chown -R node:node /app/artifacts

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/api/v1/runs || exit 1

CMD ["node", "dist/api/server.js"]
