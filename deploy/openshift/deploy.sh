#!/usr/bin/env sh
# Deploy pi-share-history to the current (or named) OpenShift project.
#
#   ./deploy/openshift/deploy.sh            # deploy into the current project
#   ./deploy/openshift/deploy.sh my-ns      # ... into another project you can write to
#
# The image is pulled from GitHub Container Registry. Override the version with:
#   PI_HISTORY_IMAGE=ghcr.io/thoraxe/pi-share-history:0.2.0 ./deploy/openshift/deploy.sh
#
# For a private package, create a pull secret first and name it:
#   oc create secret docker-registry ghcr-pull \
#     --docker-server=ghcr.io --docker-username=<user> --docker-password=<token>
#   PI_HISTORY_PULL_SECRET=ghcr-pull ./deploy/openshift/deploy.sh
#
# Set PI_HISTORY_ALLOW_ROUTER=1 to also install the optional NetworkPolicy that
# lets the ingress router reach the pods; needed only if the project already
# restricts ingress traffic.
#
# Idempotent: rerunning keeps the existing UPLOAD_KEY and PersistentVolumeClaim,
# and re-resolves the public URL from the Route.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ns=${1:-}
image=${PI_HISTORY_IMAGE:-ghcr.io/thoraxe/pi-share-history:0.1.0}

if [ -n "$ns" ]; then
  oc_ns() { oc -n "$ns" "$@"; }
else
  oc_ns() { oc "$@"; }
fi

say() { printf '\n==> %s\n' "$*"; }

command -v oc >/dev/null 2>&1 || { echo "oc is required in PATH" >&2; exit 1; }
oc whoami >/dev/null 2>&1 || { echo "Not logged in. Run 'oc login' first." >&2; exit 1; }
[ -n "$ns" ] || ns=$(oc project -q)

say "Project: $ns"
say "Image: $image"

say "Applying PVC and Service"
oc_ns apply -f "$here/pvc.yaml" -f "$here/service.yaml"

say "Applying Route and resolving its hostname"
oc_ns apply -f "$here/route.yaml"
if [ "${PI_HISTORY_ALLOW_ROUTER:-0}" = 1 ]; then
  say "Allowing ingress router traffic (PI_HISTORY_ALLOW_ROUTER=1)"
  oc_ns apply -f "$here/netpol-allow-router.yaml"
fi
for _ in $(seq 1 30); do
  host=$(oc_ns get route pi-history -o jsonpath='{.spec.host}' 2>/dev/null || true)
  [ -n "$host" ] && break
  sleep 2
done
[ -n "$host" ] || { echo "Route host was not assigned" >&2; exit 1; }
public_url="https://$host/pi-history"
echo "Route: $public_url"

say "Writing PUBLIC_URL into ConfigMap"
oc_ns create configmap pi-history-config --from-literal=PUBLIC_URL="$public_url" \
  --dry-run=client -o yaml | oc_ns apply -f -

if oc_ns get secret pi-history-secrets >/dev/null 2>&1; then
  say "Keeping existing upload key"
else
  say "Creating team upload key"
  key=$(openssl rand -hex 32)
  oc_ns create secret generic pi-history-secrets --from-literal=UPLOAD_KEY="$key"
  printf 'Publishers use this value as PI_SHARE_KEY:\n\n  %s\n\n' "$key"
fi

if [ -n "${PI_HISTORY_PULL_SECRET:-}" ]; then
  say "Linking pull secret $PI_HISTORY_PULL_SECRET to the default service account"
  oc_ns secrets link default "$PI_HISTORY_PULL_SECRET" --for=pull
fi

# restricted SCCs only accept an fsGroup from the project's allotted range.
groups=$(oc_ns get ns "$ns" -o jsonpath='{.metadata.annotations.openshift\.io/sa\.scc\.supplemental-groups}' 2>/dev/null || true)
fs_group=${groups%%/*}
if [ -n "$fs_group" ]; then
  say "Setting fsGroup to $fs_group (from the project's supplemental-groups range)"
else
  fs_group=1000
  say "No supplemental-groups annotation; using fsGroup $fs_group"
fi

say "Deploying $image"
sed -e "s/^        fsGroup: 1000$/        fsGroup: $fs_group/" \
    -e "s|^          image: ghcr.io/thoraxe/pi-share-history:.*$|          image: $image|" \
    "$here/deployment.yaml" | oc_ns apply -f -

say "Waiting for the rollout"
oc_ns rollout status deployment/pi-history --timeout=180s

say "Checking the public health endpoint"
if curl -fsS --max-time 10 "$public_url/health"; then
  echo
else
  echo "Health check failed from this machine; try: curl -fsS $public_url/health" >&2
fi

cat <<EOF

Viewer: $public_url/
Publishers:
  export PI_SHARE_URL=$public_url
  export PI_SHARE_KEY=<the value of the pi-history-secrets UPLOAD_KEY key>
  pi

Read the upload key with:
  oc -n $ns get secret pi-history-secrets -o jsonpath='{.data.UPLOAD_KEY}' | base64 -d; echo
EOF
