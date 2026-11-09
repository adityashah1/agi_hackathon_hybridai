#!/usr/bin/env bash
# Build the panel into an amd64 container image for AWS App Runner and push it to ECR.
#
#   IMAGE=383845656169.dkr.ecr.us-east-1.amazonaws.com/hybrid-gate-panel:latest \
#     frontend/deploy/aws/build-image.sh
#
# Steps: `pnpm --filter panel build` (standalone output), stage server + static
# assets + the repo files the panel reads next to the Dockerfile, log in to ECR,
# `docker buildx build --platform $PLATFORM --push`. Knobs: SKIP_BUILD=1 reuses
# the last Next build; DOCKERFILE=Dockerfile.lambda and PLATFORM=linux/arm64
# build the Lambda variant (default: Dockerfile for App Runner, linux/amd64).
# Needs Docker running and the AWS CLI configured.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PANEL="$ROOT/frontend/apps/panel"
IMAGE="${IMAGE:?set IMAGE to <registry>/<repo>:<tag>}"
STAGE="${STAGE_DIR:-$(mktemp -d -t hybrid-gate-panel)}"
DOCKERFILE="${DOCKERFILE:-$HERE/Dockerfile}"
PLATFORM="${PLATFORM:-linux/amd64}"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  (cd "$ROOT/frontend" && pnpm --filter panel build)
fi
if [ ! -f "$PANEL/.next/standalone/apps/panel/server.js" ]; then
  echo "no standalone output at apps/panel/.next/standalone; is output: 'standalone' set in next.config.ts?" >&2
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/public" "$STAGE/repo/tasks" "$STAGE/repo/runner"
cp -R "$PANEL/.next/standalone" "$STAGE/standalone"
cp -R "$PANEL/.next/static" "$STAGE/static"
if [ -d "$PANEL/public" ]; then
  cp -R "$PANEL/public/." "$STAGE/public/"
fi
cp "$ROOT/tasks/tasks.yaml" "$STAGE/repo/tasks/"
cp "$ROOT/runner/schema.py" "$STAGE/repo/runner/"
rsync -a --exclude '*.py' --exclude '__pycache__' "$ROOT/mock_apps/" "$STAGE/repo/mock_apps/"
cp "$DOCKERFILE" "$STAGE/Dockerfile"
echo "staged in $STAGE ($(du -sh "$STAGE" | cut -f1))"

REGISTRY="${IMAGE%%/*}"
if [[ "$REGISTRY" == *.amazonaws.com ]]; then
  REGION="$(echo "$REGISTRY" | sed -E 's/^[0-9]+\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com$/\1/')"
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
fi
# --provenance=false: App Runner wants a plain single-platform image manifest, not an attestation index.
docker buildx build --platform "$PLATFORM" --provenance=false -t "$IMAGE" --push "$STAGE"
echo "pushed $IMAGE"
