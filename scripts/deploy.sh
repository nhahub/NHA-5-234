#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
stage deploy
: "${NODE_PORT:=30100}"
if dry; then echo "[dry-run] kubectl apply"; sleep 1; echo "APP_URL=http://localhost:$NODE_PORT"; exit 0; fi

if [ "$TARGET" = "microk8s" ]; then
  KUBECTL=("$MICROK8S" kubectl)
  HOST="localhost"
else
  export KUBECONFIG="$PLATFORM/kubeconfig"
  KUBECTL=(kubectl)
  HOST="$(cat "$PLATFORM/ip.txt")"
fi

export PROJECT_NAME NODE_PORT NAMESPACE="$ENVIRONMENT" IMAGE="$(cat "$WORK/image.txt")" REPLICAS APP_PORT="${APP_PORT:-3000}"
envsubst '${PROJECT_NAME} ${NAMESPACE} ${IMAGE} ${REPLICAS} ${APP_PORT} ${NODE_PORT}' < "$ROOT/k8s/app.yaml.tpl" > "$WORK/app.yaml"

"${KUBECTL[@]}" create namespace "$ENVIRONMENT" --dry-run=client -o yaml | "${KUBECTL[@]}" apply -f -
"${KUBECTL[@]}" apply -f "$WORK/app.yaml"
"${KUBECTL[@]}" -n "$ENVIRONMENT" rollout status "deploy/$PROJECT_NAME" --timeout=180s
echo "APP_URL=http://$HOST:$NODE_PORT"
