FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (e.g. better-sqlite3)
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY client/package*.json ./client/

# Install all dependencies (including devDependencies for building)
RUN npm ci
RUN cd client && npm ci

# Copy source code
COPY . .

# Build the client
RUN npm run build

# Remove devDependencies to keep the final image light
RUN npm prune --omit=dev

# ==========================================
# Final Stage
# ==========================================
FROM node:22-bookworm-slim

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/*

# Copy production dependencies and built files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/client/dist ./client/dist

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3002
# Keep data in /app/.guardclaw by default
ENV GUARDCLAW_DATA_DIR=/app

# Expose the server port
EXPOSE 3002

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3002/api/health || exit 1

# Run the application
CMD ["node", "server/index.js"]