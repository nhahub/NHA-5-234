#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
stage build
if dry; then echo "[dry-run] docker build + push"; sleep 1; echo "demo/$PROJECT_NAME:abc1234" > "$WORK/image.txt"; exit 0; fi

: "${REPO_URL:?}" "${DOCKER_USER:?DOCKER_USER is required}" "${DOCKER_TOKEN:?DOCKER_TOKEN is required}"
rm -rf "$WORK/src"
git clone --depth 1 -- "$REPO_URL" "$WORK/src"
TAG="$(git -C "$WORK/src" rev-parse --short HEAD)"
IMAGE="$DOCKER_USER/$PROJECT_NAME:$TAG"
docker build -t "$IMAGE" "$WORK/src"
echo "$DOCKER_TOKEN" | docker login -u "$DOCKER_USER" --password-stdin
docker push "$IMAGE"
echo "$IMAGE" > "$WORK/image.txt"
