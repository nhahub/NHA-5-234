#!/usr/bin/env bash
# TARGET=aws: deletes the shared AWS server so it stops using free-tier hours. Run it after every session.
PROJECT_NAME=_destroy
source "$(dirname "$0")/common.sh"
if [ "$TARGET" = "microk8s" ]; then
  echo "TARGET=microk8s: nothing on AWS to destroy."
  echo "To remove an app from MicroK8s:  microk8s kubectl delete namespace <environment>"
  exit 0
fi
if [ -f "$PLATFORM/terraform.tfstate" ]; then
  TF=(terraform "-chdir=$ROOT/terraform")
  "${TF[@]}" destroy -auto-approve -input=false -state="$PLATFORM/terraform.tfstate" \
    -var "project_name=autodeployers-platform" -var "environment=shared" -var "public_key_path=$PLATFORM/key.pub" \
    -var "instance_type=${INSTANCE_TYPE:-t3.micro}"
fi
rm -rf "$PLATFORM" "$WORK"
echo "Server destroyed. The next deployment will create a fresh one."
