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

## Kubernetes + Harbor (closed network)

Manifest: [deploy/k8s/jaslide-k8s.yaml](../deploy/k8s/jaslide-k8s.yaml), [Kustomization](../deploy/k8s/kustomization.yaml). Replace every `CHANGE_ME` and the Ingress host before applying. Kustomize places all namespaced resources in the `jaslide` namespace.

**1. Build images on an internet-connected machine.** The release image defaults to relative `/api`, so it remains valid when the final Ingress hostname changes:

```bash
./scripts/release/build-amd64-images.sh v0.2.0
```

**2. Save to tar and carry into the closed network:**

The script produces `dist/release/jaslide-v0.2.0-linux-amd64-images.tar.gz` and its SHA-256 checksum. This one archive contains the API, web, renderer, PostgreSQL, and Redis images.

**3. Load and push to Harbor (inside the closed network):**

```bash
shasum -a 256 -c jaslide-v0.2.0-linux-amd64-images.tar.gz.sha256
podman load -i jaslide-v0.2.0-linux-amd64-images.tar.gz
podman image inspect --format '{{.Architecture}}' jaslide/api:v0.2.0  # amd64
podman tag jaslide/api:v0.2.0 harbor.example.internal/jaslide/api:v0.2.0
podman tag jaslide/web:v0.2.0 harbor.example.internal/jaslide/web:v0.2.0
podman tag jaslide/renderer:v0.2.0 harbor.example.internal/jaslide/renderer:v0.2.0
podman tag jaslide/postgres:v0.2.0 harbor.example.internal/jaslide/postgres:v0.2.0
podman tag jaslide/redis:v0.2.0 harbor.example.internal/jaslide/redis:v0.2.0
podman push harbor.example.internal/jaslide/api:v0.2.0
podman push harbor.example.internal/jaslide/web:v0.2.0
podman push harbor.example.internal/jaslide/renderer:v0.2.0
podman push harbor.example.internal/jaslide/postgres:v0.2.0
podman push harbor.example.internal/jaslide/redis:v0.2.0
```

Create the `jaslide` project in Harbor first, and `podman login harbor.example.internal` before pushing.

**4. Deploy:**

```bash
kubectl -n jaslide create secret docker-registry harbor-regcred \
  --docker-server=harbor.example.internal --docker-username=<user> --docker-password=<pass>
kubectl apply -k deploy/k8s
kubectl -n jaslide get pods -w
```

Readiness: `curl https://jaslide.internal/api/health` once the Ingress resolves. The default web image uses `/api`; rebuild it only when an external API origin is deliberately configured.
