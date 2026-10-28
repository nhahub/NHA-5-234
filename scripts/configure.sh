#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
stage configure
if dry; then echo "[dry-run] configure ($TARGET)"; sleep 1; exit 0; fi

if [ "$TARGET" = "microk8s" ]; then
  if [ ! -x "$MICROK8S" ]; then
    echo "ERROR: MicroK8s not found at $MICROK8S."
    echo "Install it inside WSL/Ubuntu:  sudo snap install microk8s --classic"
    echo "Then:  sudo usermod -a -G microk8s \$USER   (open a new terminal afterwards)"
    exit 1
  fi
  "$MICROK8S" status --wait-ready
  "$MICROK8S" kubectl get nodes
  exit 0
fi

# ---- TARGET=aws ----
if [ -f "$PLATFORM/kubeconfig" ]; then echo "Server already configured - skipping."; exit 0; fi
: "${SSH_KEY_PATH:?SSH_KEY_PATH is required for TARGET=aws}"
IP="$(cat "$PLATFORM/ip.txt")"
export ANSIBLE_HOST_KEY_CHECKING=False
ansible-playbook -i "$IP," -u ubuntu --private-key "$SSH_KEY_PATH" \
  -e "kubeconfig_dest=$PLATFORM/kubeconfig" "$ROOT/ansible/playbook.yml"
sed -i "s#https://127.0.0.1:6443#https://$IP:6443#" "$PLATFORM/kubeconfig"
