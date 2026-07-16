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

Manifest: [deploy/k8s/jaslide-k8s.yaml](../deploy/k8s/jaslide-k8s.yaml). Replace every `CHANGE_ME` and the Ingress host before applying.

**1. Build images on an internet-connected machine.** `NEXT_PUBLIC_API_URL` is baked into the web image at build time — set it to the final browser URL (the Ingress host) before building:

```powershell
docker build -f docker/api.Dockerfile      -t jaslide/api:0.1.0 .
docker build -f docker/web.Dockerfile      -t jaslide/web:0.1.0 --build-arg NEXT_PUBLIC_API_URL=https://jaslide.internal/api .
docker build -f docker/renderer.Dockerfile -t jaslide/renderer:0.1.0 .
docker pull postgres:16-alpine
docker pull redis:7-alpine
```

**2. Save to tar and carry into the closed network:**

```powershell
docker save jaslide/api:0.1.0      -o jaslide-api-0.1.0.tar
docker save jaslide/web:0.1.0      -o jaslide-web-0.1.0.tar
docker save jaslide/renderer:0.1.0 -o jaslide-renderer-0.1.0.tar
docker save postgres:16-alpine     -o postgres-16-alpine.tar
docker save redis:7-alpine         -o redis-7-alpine.tar
```

**3. Load and push to Harbor (inside the closed network):**

```bash
podman load -i jaslide-api-0.1.0.tar
podman tag  jaslide/api:0.1.0 harbor.example.internal/jaslide/api:0.1.0
podman push harbor.example.internal/jaslide/api:0.1.0
# repeat for web, renderer, postgres:16-alpine, redis:7-alpine
```

Create the `jaslide` project in Harbor first, and `podman login harbor.example.internal` before pushing.

**4. Deploy:**

```bash
kubectl create secret docker-registry harbor-regcred \
  --docker-server=harbor.example.internal --docker-username=<user> --docker-password=<pass>
kubectl apply -f deploy/k8s/jaslide-k8s.yaml
kubectl get pods -w
```

Readiness: `curl https://jaslide.internal/api/health` once the Ingress resolves. If the browser URL ever changes, rebuild and re-push only the web image with the new `NEXT_PUBLIC_API_URL`.
