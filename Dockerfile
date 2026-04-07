##############################################################################
# Panopticon OSINT Agent
#
# Build:  docker build -t panopticon .
# Run:    docker run -p 3000:3000 panopticon
# Web UI: http://localhost:3000
##############################################################################

# ---- Builder stage ----
FROM node:22-slim AS builder
WORKDIR /app

# Install root dependencies (include devDeps for tsx runtime)
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Install webapp dependencies + build frontend
COPY webapp/package.json webapp/package-lock.json* webapp/
RUN cd webapp && npm install 2>/dev/null || true
COPY webapp/ webapp/
RUN cd webapp && npx vite build 2>/dev/null || true

# Copy source
COPY src/ src/
COPY tsconfig.json ./

# ---- Runtime stage ----
FROM node:22-slim
WORKDIR /app

# Install OSINT system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    whois dnsutils openssl curl ca-certificates traceroute nmap \
    && rm -rf /var/lib/apt/lists/*

# Copy built app
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/src src/
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./

# Copy frontend (may not exist if build failed — create empty dir)
RUN mkdir -p public
COPY --from=builder /app/webapp/dist/ public/

# Environment defaults
ENV NODE_ENV=production \
    AGENT_API_AUTH=false \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "--import", "tsx", "src/api/server.ts"]
