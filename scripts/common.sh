set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${PROJECT_NAME:?PROJECT_NAME is required}"
TARGET="${TARGET:-microk8s}"       # microk8s = this machine (free) | aws = one EC2 server running k3s
case "$TARGET" in microk8s|aws) ;; *) echo "ERROR: TARGET must be microk8s or aws (got '$TARGET')"; exit 1 ;; esac
BASE="${DATA_DIR:-$ROOT/workspace}"
PLATFORM="$BASE/_platform"         # the shared cluster (ip, kubeconfig, terraform state)
WORK="$BASE/$PROJECT_NAME"         # per-deployment files (source, image tag, manifest)
mkdir -p "$PLATFORM" "$WORK"
stage() { echo "### STAGE: $1"; }           # the backend reads these markers
dry()   { [ "${DRY_RUN:-0}" = "1" ]; }      # DRY_RUN=1 simulates everything
MICROK8S="${MICROK8S_BIN:-/snap/bin/microk8s}"
