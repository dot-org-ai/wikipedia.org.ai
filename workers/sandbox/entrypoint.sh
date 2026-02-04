#!/bin/bash
set -e

# Mount R2 bucket using s3fs if credentials are provided
if [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] && [ -n "$R2_ENDPOINT" ]; then
    echo "[Entrypoint] Mounting R2 bucket at /mnt/r2..."

    # Create credentials file
    echo "${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}" > /root/.passwd-s3fs
    chmod 600 /root/.passwd-s3fs

    # Mount the bucket
    s3fs "${R2_BUCKET_NAME:-wikipedia-data}" /mnt/r2 \
        -o passwd_file=/root/.passwd-s3fs \
        -o url="${R2_ENDPOINT}" \
        -o use_path_request_style \
        -o allow_other \
        -o nonempty \
        -o retries=3 \
        -o connect_timeout=30 \
        -o readwrite_timeout=60 \
        -o max_stat_cache_size=10000 \
        -o stat_cache_expire=60 \
        -o multipart_size=100 \
        -o parallel_count=5

    echo "[Entrypoint] R2 bucket mounted successfully"
else
    echo "[Entrypoint] R2 credentials not provided, skipping mount"
fi

# Start the sandbox worker
# The TypeScript file is transpiled at build time or we run it with ts-node/bun
echo "[Entrypoint] Starting Wikipedia ingestion worker..."
if [ -f "dist/workers/sandbox/workers/sandbox/index.js" ]; then
    exec node dist/workers/sandbox/workers/sandbox/index.js
elif [ -f "dist/workers/sandbox/index.js" ]; then
    exec node dist/workers/sandbox/index.js
else
    # Fall back to running TS directly with npx tsx
    echo "[Entrypoint] Running TypeScript source directly..."
    exec npx tsx workers/sandbox/index.ts
fi
