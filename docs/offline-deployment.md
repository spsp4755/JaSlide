# 폐쇄망 배포

폐쇄망 대상 서버에서는 소스 빌드, npm/pnpm, Go module 다운로드, pip, APT,
container registry pull을 수행하지 않습니다. 외부망 준비 환경에서 만든
linux/amd64 image archive만 반입합니다.

## 1. 외부망 준비

신뢰하는 commit에서 다음 명령을 실행합니다. base image는 digest로 고정되어
있고 Go/Vite/Python 의존성은 lockfile 또는 checksum으로 고정됩니다.

```bash
./scripts/release/build-amd64-images.sh v0.6.1
```

script는 아래 여섯 image가 모두 `linux/amd64`인지 검사하고 하나의 gzip
archive와 SHA-256 파일을 생성합니다.

- `jaslide/core-api:v0.6.1`
- `jaslide/migrate:v0.6.1`
- `jaslide/web:v0.6.1`
- `jaslide/renderer:v0.6.1`
- `jaslide/postgres:v0.6.1`
- `jaslide/redis:v0.6.1`

## 2. 반입 및 무결성 확인

```bash
sha256sum -c jaslide-v0.6.1-linux-amd64-images.tar.gz.sha256
```

Kubernetes는 모든 worker node에서 직접 import합니다.

```bash
sudo ctr -n k8s.io images import jaslide-v0.6.1-linux-amd64-images.tar.gz
sudo ctr -n k8s.io images ls | grep jaslide
```

Docker Compose는 Docker engine에 한 번만 load합니다.

```bash
docker load -i jaslide-v0.6.1-linux-amd64-images.tar.gz
```

## 3. 외부 registry 없이 실행

`.env.example`을 기준으로 `.env`를 만들고 비밀번호, origin, Keycloak,
OpenAI-compatible LLM 값을 설정합니다. HTTPS 운영은
`NODE_ENV=production`, 로컬 HTTP 검증은 `NODE_ENV=development`를 사용합니다.

```bash
export JASLIDE_VERSION=v0.6.1
docker compose --project-name jaslide --env-file .env \
  --file docker-compose.offline.yml up -d --no-build --pull never
BASE_URL=http://localhost:3000 ./scripts/release/smoke-compose.sh --check-only
```

`pull_policy: never`와 `--pull never` 때문에 image가 누락되면 registry에
접속하지 않고 실패합니다. API와 renderer는 host port가 없고 web의 동일
origin proxy로만 접근합니다. 사내 Keycloak/LLM endpoint는 폐쇄망 내부에서
계속 접근 가능해야 합니다.

`migrate`는 PostgreSQL healthcheck 다음에 한 번 실행되고 성공해야 API가
시작됩니다. 새 DB bootstrap과 기존 Prisma migration 승계가 모두 같은 image에
포함되어 있으므로 폐쇄망에서 npm/pnpm이나 NestJS runtime을 사용하지 않습니다.
실패하면 `docker compose --project-name jaslide --file docker-compose.offline.yml
logs migrate`로 원인을 확인하고 DB 백업을 복원하거나 migration 이력을
정리한 뒤 다시 실행합니다.

## 4. 점검표

- archive SHA-256이 외부망 준비 환경의 값과 일치한다.
- 여섯 image가 모두 `linux/amd64`이며 올바른 release tag를 가진다.
- `/login`이 React entry document를 반환한다.
- `/api/health/ready`가 `200 {"status":"ok"}`를 반환한다.
- 기존 `postgres_data`, `redis_data`, `assets_data` volume의 백업이 있다.
- 업로드 mount가 `/app/apps/api/uploads`로 유지된다.
- renderer service 이름과 Keycloak/OpenAI 환경 변수 이름이 유지된다.
- 운영 시작 과정에서 build 또는 registry pull이 발생하지 않는다.
