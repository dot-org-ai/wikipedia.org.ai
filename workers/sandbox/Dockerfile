# Cloudflare Container for Wikipedia Ingestion
#
# This container runs long-running Wikipedia dump processing jobs
# with R2 mounted via FUSE for direct filesystem access.

FROM node:22-slim

# Install dependencies for FUSE and s3fs
RUN apt-get update && apt-get install -y \
    fuse \
    s3fs \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create mount points
RUN mkdir -p /mnt/r2

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy compiled application
COPY dist/ ./dist/

# Copy startup script
COPY workers/sandbox/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Environment variables (these will be passed from Worker)
ENV MODE=ingest
ENV OUTPUT_DIR=/mnt/r2/wikipedia
ENV BATCH_SIZE=5000
ENV CHECKPOINT_INTERVAL=10000
ENV HTTP_PORT=8080
ENV SKIP_REDIRECTS=true
ENV SKIP_DISAMBIGUATION=true
ENV LOG_INTERVAL=1000

# Expose the HTTP port for health checks and status
EXPOSE 8080

# Use entrypoint script to mount R2 then start the app
ENTRYPOINT ["/entrypoint.sh"]
