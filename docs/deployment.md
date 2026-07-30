# Go API + React 배포

운영 런타임은 Go core API, Nginx가 제공하는 Vite React 정적 파일, Python
renderer, PostgreSQL, Redis입니다. NestJS와 Next.js 서버는 실행하지 않습니다.
브라우저에는 web 포트만 공개되며 `/api`, `/uploads`, `/socket.io`는 Nginx가
내부 `api:4000`으로 프록시합니다.

## Docker Compose

`.env.example`을 `.env`로 복사하고 최소한 `POSTGRES_PASSWORD`, `JWT_SECRET`,
`CORS_ORIGIN`, `FRONTEND_URL`을 설정합니다. HTTPS 뒤에서 운영할 때는
`NODE_ENV=production`으로 설정합니다. Keycloak을 사용하면 기존
`KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`,
`KEYCLOAK_REDIRECT_URI`, `KEYCLOAK_ADMIN_ROLES` 이름을 그대로 채웁니다.

인터넷이 되는 빌드 환경에서 고정된 base image와 lockfile로 linux/amd64
이미지를 만듭니다.

```bash
JASLIDE_VERSION=v0.6.1 docker compose --file docker-compose.yml --env-file .env build
JASLIDE_VERSION=v0.6.1 docker compose --file docker-compose.yml --env-file .env \
  up -d --no-build --pull never
BASE_URL=http://localhost:3000 ./scripts/release/smoke-compose.sh --check-only
```

`postgres_data`, `redis_data`, `assets_data` named volume은 재배포에도 유지됩니다.
업로드 경로는 계속 `/app/apps/api/uploads`입니다. 새 PostgreSQL volume에는
현재 스키마가 최초 initdb 때 적용되고, 기존 PostgreSQL volume은 변경하지
않습니다. renderer와 API를 직접 공개해야 하는 진단 환경은
명시적인 진단 파일만 추가해 실행하십시오. 파일을 지정하지 않은 자동 override는
운영 명령에서 사용하지 않습니다.

```bash
docker compose --file docker-compose.yml \
  --file docker-compose.diagnostics.yml --env-file .env up -d
```

## 폐쇄망 Compose

외부망에서 만든 release archive를 반입한 뒤:

```bash
sha256sum -c jaslide-v0.6.1-linux-amd64-images.tar.gz.sha256
docker load -i jaslide-v0.6.1-linux-amd64-images.tar.gz
export JASLIDE_VERSION=v0.6.1
docker compose --project-name jaslide --env-file .env \
  --file docker-compose.offline.yml up -d --no-build --pull never
BASE_URL=http://localhost:3000 ./scripts/release/smoke-compose.sh --check-only
```

`docker-compose.offline.yml`은 `pull_policy: never`를 지정하므로 로드되지 않은
이미지를 registry에서 받지 않고 즉시 실패합니다. 내부 Keycloak과
OpenAI-compatible LLM 주소에는 사내망으로 접근할 수 있어야 합니다.

## Kubernetes, registry 없이 배포

외부망의 amd64 빌드 환경에서:

```bash
./scripts/release/build-amd64-images.sh v0.6.1
```

생성물:

- `dist/release/jaslide-v0.6.1-linux-amd64-images.tar.gz`
- `dist/release/jaslide-v0.6.1-linux-amd64-images.tar.gz.sha256`

폐쇄망의 모든 worker node에서:

```bash
sha256sum -c jaslide-v0.6.1-linux-amd64-images.tar.gz.sha256
sudo ctr -n k8s.io images import jaslide-v0.6.1-linux-amd64-images.tar.gz
sudo ctr -n k8s.io images ls | grep jaslide
```

`deploy/k8s/jaslide-k8s.yaml`의 `CHANGE_ME`, Ingress host, Keycloak/LLM 값을
수정한 뒤 master에서:

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/jaslide-k8s.yaml
kubectl -n jaslide get pods -w
curl --fail https://jaslide.internal/api/health/ready
curl --fail https://jaslide.internal/login
```

manifest의 다섯 image는 `imagePullPolicy: Never`이므로 worker에 image가 없으면
외부 registry 접근 없이 실패합니다. Registry를 사용할 때만 image 경로를
바꾸고 `imagePullPolicy: IfNotPresent`와 `imagePullSecrets`를 추가합니다.
