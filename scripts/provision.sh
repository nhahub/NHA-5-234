#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
stage provision
if dry; then echo "[dry-run] provision ($TARGET)"; sleep 1; exit 0; fi

if [ "$TARGET" = "microk8s" ]; then
  echo "[microk8s] Using this machine as the Kubernetes server. No AWS resources are created."
  echo "127.0.0.1" > "$PLATFORM/ip.txt"
  exit 0
fi

# ---- TARGET=aws: free tier = ONE instance. First deployment creates it, later ones reuse it. ----
if [ -f "$PLATFORM/ip.txt" ]; then echo "Server already exists ($(cat "$PLATFORM/ip.txt")) - reusing it."; exit 0; fi

: "${SSH_KEY_PATH:?SSH_KEY_PATH is required for TARGET=aws}"
ssh-keygen -y -f "$SSH_KEY_PATH" > "$PLATFORM/key.pub"
TF=(terraform "-chdir=$ROOT/terraform")     # array, NOT a quoted string
"${TF[@]}" init -input=false
"${TF[@]}" apply -auto-approve -input=false -state="$PLATFORM/terraform.tfstate" \
  -var "project_name=autodeployers-platform" -var "environment=shared" \
  -var "public_key_path=$PLATFORM/key.pub" -var "instance_type=${INSTANCE_TYPE:-t3.micro}"
"${TF[@]}" output -state="$PLATFORM/terraform.tfstate" -raw public_ip > "$PLATFORM/ip.txt"
echo "Server IP: $(cat "$PLATFORM/ip.txt")"
