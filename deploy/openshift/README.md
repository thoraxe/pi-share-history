# OpenShift deployment

Deploys the sharing service into an OpenShift project by pulling the released
image from GitHub Container Registry. There is no build in the cluster, no npm
install, and no reverse proxy: TLS terminates at the ingress router and the pod
stays on plain HTTP behind a Service.

The result is the same service described in the [main README](../../README.md),
reachable at `https://<route-host>/pi-history`.

## What gets created

| Object | Purpose |
| --- | --- |
| `PersistentVolumeClaim/pi-history-data` | SQLite storage, `ReadWriteOnce`, 1 Gi. |
| `ConfigMap/pi-history-config` | `PUBLIC_URL`, which also sets the route prefix. |
| `Secret/pi-history-secrets` | Team upload key (`UPLOAD_KEY`), generated on first deploy. |
| `Deployment/pi-history` | One replica of `node server/index.mjs` on port 9080. |
| `Service/pi-history` | Cluster-internal port 9080. |
| `Route/pi-history` | Edge TLS on path `/pi-history`, redirects HTTP to HTTPS. |
| `NetworkPolicy/pi-history-allow-router` | Optional; installs only with `PI_HISTORY_ALLOW_ROUTER=1`. |

The image comes from `ghcr.io/thoraxe/pi-share-history`. Releases are described
in the [main README](../../README.md#releases).

## Quick start

```sh
oc login ...            # a project where you can create deployments and routes
./deploy/openshift/deploy.sh
```

Pass a project name to deploy elsewhere: `./deploy/openshift/deploy.sh my-project`.
The script is idempotent. It applies the manifests, reads the assigned route
hostname, writes `PUBLIC_URL`, derives the required `fsGroup` from the project,
waits for the rollout, and prints the viewer URL plus publisher settings. The
first run prints the generated upload key; later runs keep it.

Point publishers at the deployment, from the shell where Pi starts:

```sh
export PI_SHARE_URL=https://<route-host>/pi-history
export PI_SHARE_KEY='<the UPLOAD_KEY value>'
pi
```

Read the key again with:

```sh
oc get secret pi-history-secrets -o jsonpath='{.data.UPLOAD_KEY}' | base64 -d; echo
```

## Choosing a version

The deployment pins a full image version. Change it with `PI_HISTORY_IMAGE`:

```sh
PI_HISTORY_IMAGE=ghcr.io/thoraxe/pi-share-history:0.2.0 ./deploy/openshift/deploy.sh
```

or by hand:

```sh
oc set image deployment/pi-history pi-history=ghcr.io/thoraxe/pi-share-history:0.2.0
oc rollout status deployment/pi-history
```

Do not use `:latest` in a deployment you care about. `latest` moves with every
release, and a rollback becomes guesswork.

If the package is private, create a pull secret and link it to the default
service account once:

```sh
oc create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io --docker-username=<user> --docker-password=<token>
oc secrets link default ghcr-pull --for=pull
```

Or let the script do it: `PI_HISTORY_PULL_SECRET=ghcr-pull ./deploy/openshift/deploy.sh`.

## Manual deployment

The manifests are plain YAML and can be applied without the script, but three
things are project-specific and must be set by hand.

1. Apply the storage, service and route, then read the route hostname:

   ```sh
   oc apply -f deploy/openshift/pvc.yaml -f deploy/openshift/service.yaml
   oc apply -f deploy/openshift/route.yaml
   oc get route pi-history -o jsonpath='{.spec.host}'
   ```

2. Create the ConfigMap with `PUBLIC_URL` set to `https://<route-host>/pi-history`,
   matching the route path exactly, and create the upload key:

   ```sh
   oc create configmap pi-history-config \
     --from-literal=PUBLIC_URL="https://<route-host>/pi-history"
   oc create secret generic pi-history-secrets \
     --from-literal=UPLOAD_KEY="$(openssl rand -hex 32)"
   ```

3. Set `fsGroup` in `deployment.yaml` before applying it. The application stores
   SQLite on the claim, and restricted security context constraints only accept a
   group from the project's allotted range:

   ```sh
   oc get ns "$(oc project -q)" \
     -o jsonpath='{.metadata.annotations.openshift\.io/sa\.scc\.supplemental-groups}'
   # e.g. 1000000000/10000 -> use 1000000000
   oc apply -f deploy/openshift/deployment.yaml
   oc rollout status deployment/pi-history
   ```

## Why these settings

- **Path prefix.** `PUBLIC_URL` drives both the generated viewer links and the
  application's own routes, so it must match the Route path. The OpenShift router
  forwards the path unchanged, which is what the application expects. Root
  deployments work too: drop `spec.path` from the Route, set `PUBLIC_URL` to
  `https://<host>`, and change the probe paths to `/health`.
- **Long route timeout.** Live uploads use Server-Sent Events
  (`/pi-history/api/shares/*/events`). The default 30s router idle timeout would
  disconnect every viewer, so the Route sets `haproxy.router.openshift.io/timeout`.
  Cookie stickiness is disabled because there is only one replica.
- **One replica, `Recreate`.** SQLite is a single-writer WAL database on a
  `ReadWriteOnce` block volume. Do not scale the Deployment, use a HorizontalPodAutoscaler,
  or point it at a shared filesystem such as NFS.
- **`fsGroup`.** The container runs as an arbitrary UID assigned by OpenShift, so
  it cannot rely on the image's `chown node:node /data`. Kubernetes applies
  `fsGroup` to the mounted claim to make it writable.
- **Probes.** `/pi-history/health` is served under the prefix and needs no
  credentials.
- **`imagePullPolicy: IfNotPresent`.** The tag is immutable, so there is nothing
  to re-pull. A moved tag needs a rollout restart.
- **No ingress exposure of 9080.** Only the Route is reachable; the Service is
  cluster-internal.

## Operating it

```sh
oc logs deployment/pi-history            # service log
oc rollout status deployment/pi-history  # after an image change
oc get deployment pi-history -o jsonpath='{.spec.template.spec.containers[0].image}'
oc delete route pi-history               # stop public access, keep data
```

- **Upgrade.** Change the image tag, then watch the rollout. The SQLite volume
  stays; a release that changes the schema migrates it on startup.
- **Rollback.** Set the image back to the previous full version. Do not roll back
  across a schema migration without a backup.
- **Backups.** Stop the application briefly and copy the claim, or use a
  SQLite-aware tool: `oc scale deployment/pi-history --replicas=0`, snapshot the
  volume, then scale back to 1. Do not copy only the `.sqlite` file from a running
  database; acknowledged writes may still be in the `-wal` file.
- **Rotate the upload key.** `oc delete secret pi-history-secrets`, then rerun
  `deploy.sh` to generate a new one and restart the pod. Existing per-share owner
  keys keep working, as described in the main README.
- **Wipe data.** Delete the `pi-history-data` claim after scaling to zero, then
  redeploy. `oc delete project` removes everything.
- **Disk limits.** The default 1 Gi claim holds roughly the same total as the
  application's own per-share quotas allow for a small team; grow the claim if you
  keep many sessions.

## Troubleshooting access

**The Route is `Admitted` and `curl http://pi-history:9080/pi-history/health`
works from another pod, but the route hostname hangs or returns 503.** The
project has a `NetworkPolicy` that limits ingress, typically to one private
router shard, and the Route landed on a router whose pods it does not allow. A
quick tell is the domain root returning the router's 503 page while the route
path never answers. Two options:

- Select the expected shard by labelling the Route with the IngressController's
  `routeSelector` labels. Ask whoever runs the cluster for the selector; the
  shard may also use a different hostname, in which case update `PUBLIC_URL`.
- Allow the ingress namespace, which is what
  `deploy/openshift/netpol-allow-router.yaml` does:

  ```sh
  oc apply -f deploy/openshift/netpol-allow-router.yaml
  # or: PI_HISTORY_ALLOW_ROUTER=1 ./deploy/openshift/deploy.sh
  ```

**`ErrImagePull` or `ImagePullBackOff` on the GHCR image.** Either the version
does not exist, or the package is private and no pull secret is linked:

```sh
oc get events --sort-by=.lastTimestamp | tail -20
oc secrets link default ghcr-pull --for=pull
```

Check the release page for the version, and pull it once outside the cluster to
confirm access.

**`CreateContainerConfigError` or `EACCES` on the SQLite file.** `fsGroup` is
missing or outside the project's allowed range.

**HTTP 404 for everything under the domain root.** The Route claims only
`/pi-history`; use the full path, and check that `PUBLIC_URL` matches it.

## Limitations

Published transcripts are public: anyone who can reach the route can browse the
directory and read logs. There is no viewer login. For team-only access, add an
authenticated proxy, mTLS, or IP allowlisting
(`haproxy.router.openshift.io/ip_whitelist`) to the Route.
