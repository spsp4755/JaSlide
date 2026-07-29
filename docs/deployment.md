# Closed-network deployment

1. Copy `.env.example` to `.env` and replace `POSTGRES_PASSWORD`, `JWT_SECRET`, and the Keycloak/LLM values. Set `NEXT_PUBLIC_API_URL` to the browser-reachable internal API URL (for example `https://jaslide.example.internal/api`) and `CORS_ORIGIN` to the browser URL (for example `https://jaslide.example.internal`) before building.
2. Make the internal OpenAI-compatible endpoint reachable from the `api` container through `OPENAI_BASE_URL`.
3. Build and start the immutable images:

```powershell
docker compose --env-file .env build
docker compose --env-file .env up -d
```

The Compose file mounts PostgreSQL, Redis, and local uploaded assets as named volumes; application source is not mounted into production containers.
The API applies committed Prisma migrations before it starts.

Check readiness:

```powershell
Invoke-WebRequest http://localhost:8000/health
Invoke-WebRequest http://localhost:4000/api/health
```

The renderer image includes LibreOffice and Korean Noto font fallback for PPTX-to-PDF conversion. Client devices still need the selected font installed to edit PPTX files with identical typography.

After the first login, register the internal model in **Admin > Models** and run the connection test. Import example PPTX files in **Admin > Templates** before assigning them to generated presentations.

## Kubernetes, no registry (closed network)

Manifest: [deploy/k8s/jaslide-k8s.yaml](../deploy/k8s/jaslide-k8s.yaml), [namespace.yaml](../deploy/k8s/namespace.yaml). No Harbor, no `imagePullSecrets` — every worker node imports the image tar directly into containerd, and the build script already tags images exactly as the manifest references them (`jaslide/api:v0.6.0`, etc.), so there is no retagging step either. Replace every `CHANGE_ME` and the Ingress host before applying.

**1. Build images on an internet-connected machine.** The release image defaults to relative `/api`, so it remains valid when the final Ingress hostname changes:

```bash
./scripts/release/build-amd64-images.sh v0.6.0
```

**2. Save to tar and carry into the closed network:**

The script produces `dist/release/jaslide-v0.6.0-linux-amd64-images.tar.gz` and its SHA-256 checksum. This one archive contains the API, web, renderer, PostgreSQL, and Redis images.

**3. Import on every worker node (inside the closed network):**

```bash
shasum -a 256 -c jaslide-v0.6.0-linux-amd64-images.tar.gz.sha256
sudo ctr -n k8s.io images import jaslide-v0.6.0-linux-amd64-images.tar.gz
sudo ctr -n k8s.io images ls | grep jaslide   # confirm all 5 images landed
```

Run this on **every** node the pods can schedule onto — `imagePullPolicy: IfNotPresent` means a node without the image locally will fail to start its pod rather than reaching out to a registry.

**4. Deploy (from the master):**

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/jaslide-k8s.yaml
kubectl -n jaslide get pods -w
```

**5. Every later release:** repeat steps 1-3 for the new tag, edit the image tag (`v0.6.0` → `v0.6.0`) on the 5 `image:` lines in `jaslide-k8s.yaml`, then:

```bash
kubectl apply -f deploy/k8s/jaslide-k8s.yaml
```

No `kubectl rollout restart` needed — each release uses a distinct image tag, so Kubernetes detects the changed pod template and rolls the deployments automatically.

Readiness: `curl https://jaslide.internal/api/health` once the Ingress resolves. The default web image uses `/api`; rebuild it only when an external API origin is deliberately configured.

**Using a registry instead (e.g. Harbor):** change each `image:` to `<registry>/jaslide/<service>:v0.6.0`, add `imagePullSecrets: [{ name: <your-secret> }]` under each Deployment's pod spec, and create that secret once with `kubectl create secret docker-registry <name> --docker-server=... --dry-run=client -o yaml > secret.local.yaml && kubectl apply -f secret.local.yaml` (keep that file out of git — it holds real credentials).
