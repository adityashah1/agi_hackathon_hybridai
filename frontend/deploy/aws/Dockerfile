# The panel as a self-contained Next.js server. build-image.sh stages the
# inputs next to this file, so the build context is small and needs no pnpm:
#   standalone/   apps/panel/.next/standalone (server.js + traced node_modules)
#   static/       apps/panel/.next/static
#   public/       apps/panel/public
#   repo/         the repo files the panel reads: tasks/tasks.yaml, mock_apps/, runner/schema.py
FROM node:20-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    REPO_ROOT=/app/repo \
    RUNS_DIR=/app/repo/data/runs

WORKDIR /app
COPY standalone/ ./
COPY static/ ./apps/panel/.next/static/
COPY public/ ./apps/panel/public/
COPY repo/ ./repo/
RUN mkdir -p /app/repo/data/runs /app/apps/panel/.jobs && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "apps/panel/server.js"]
