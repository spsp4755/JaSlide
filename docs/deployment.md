# Closed-network deployment

1. Copy `.env.example` to `.env` and replace `POSTGRES_PASSWORD`, `JWT_SECRET`, and the Keycloak/LLM values.
2. Make the internal OpenAI-compatible endpoint reachable from the `api` container through `OPENAI_BASE_URL`.
3. Build and start the immutable images:

```powershell
docker compose --env-file .env build
docker compose --env-file .env up -d
```

The Compose file intentionally mounts only PostgreSQL and Redis data volumes; application source is not mounted into production containers.
The API applies committed Prisma migrations before it starts.

Check readiness:

```powershell
Invoke-WebRequest http://localhost:8000/health
Invoke-WebRequest http://localhost:4000/api/health
```

The renderer image includes LibreOffice and Korean Noto font fallback for PPTX-to-PDF conversion. Client devices still need the selected font installed to edit PPTX files with identical typography.
