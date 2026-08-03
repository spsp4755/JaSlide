# 폐쇄망 배포

폐쇄망 대상 서버에서는 소스 빌드, npm/pnpm, Go module 다운로드, pip, APT,
container registry pull을 수행하지 않습니다. 외부망 준비 환경에서 만든
linux/amd64 image archive만 반입합니다.

## 1. 외부망 준비

신뢰하는 commit에서 다음 명령을 실행합니다. base image는 digest로 고정되어
있고 Go/Vite/Python 의존성은 lockfile 또는 checksum으로 고정됩니다. renderer의
Python package는 `requirements.lock`의 SHA-256으로 검증되며 Chromium 1228은
고정된 linux/amd64 Playwright image digest에서 복사됩니다. LibreOffice와 browser
system library는 고정된 Debian snapshot에서만 설치됩니다.

```bash
./scripts/release/build-amd64-images.sh v0.8.0
```

script는 아래 여섯 image가 모두 `linux/amd64`인지 검사하고 하나의 gzip
archive와 SHA-256 파일을 생성합니다.

- `jaslide/core-api:v0.8.0`
- `jaslide/migrate:v0.8.0`
- `jaslide/web:v0.8.0`
- `jaslide/renderer:v0.8.0`
- `jaslide/postgres:v0.8.0`
- `jaslide/redis:v0.8.0`

## 2. 반입 및 무결성 확인

```bash
sha256sum -c jaslide-v0.8.0-linux-amd64-images.tar.gz.sha256
```

Kubernetes는 모든 worker node에서 직접 import합니다.

```bash
sudo ctr -n k8s.io images import jaslide-v0.8.0-linux-amd64-images.tar.gz
sudo ctr -n k8s.io images ls | grep jaslide
```

Docker Compose는 Docker engine에 한 번만 load합니다.

```bash
docker load -i jaslide-v0.8.0-linux-amd64-images.tar.gz
```

## 3. 외부 registry 없이 실행

`.env.example`을 기준으로 `.env`를 만들고 비밀번호, origin, Keycloak,
OpenAI-compatible LLM 값을 설정합니다. HTTPS 운영은
`NODE_ENV=production`, 로컬 HTTP 검증은 `NODE_ENV=development`를 사용합니다.

```bash
export JASLIDE_VERSION=v0.8.0
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

## 4. 신규 배포 초기화 (사용자·템플릿 wipe, 관리자 계정 생성)

내부 사용자 테스트를 위한 신규 배포는 개발/검증 과정에서 생성된 사용자, 관리자,
템플릿을 전혀 물려받아서는 안 됩니다. `migrate` 컨테이너가 스키마를 적용한
직후, API를 실 사용자에게 노출하기 전에 한 번만 `jaslide/core-api` image의
`cmd/seed` 바이너리를 실행해 모든 사용자(관리자 포함)와 템플릿을 지우고
관리자 계정 하나만 남깁니다.

```bash
docker run --rm --network jaslide_default \
  -e DATABASE_URL="postgresql://<user>:<password>@postgres:5432/<db>" \
  -e JASLIDE_CONFIRM_RESET="wipe all users and templates" \
  jaslide/core-api:v0.8.0 /app/seed
```

- `JASLIDE_CONFIRM_RESET`은 정확히 위 문자열이어야 실행되며, 그 외에는
  즉시 실패합니다 — 잘못 설정된 환경 변수로 우발적으로 실행되는 것을 막기
  위함입니다.
- 기본 관리자 계정은 `admin@koreacb.com` / `admin1234`이며,
  `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`로 재정의할 수 있습니다.
- `TRUNCATE ... CASCADE`로 동작하므로 사용자/템플릿뿐 아니라 그에 딸린
  발표자료, 생성 작업, 댓글 등 모든 데이터가 함께 지워집니다. **기존 운영
  데이터가 있는 DB에는 절대 실행하지 마십시오** — 완전히 새로 배포하는
  경우에만 사용합니다.
- 이미 실 사용자 데이터가 쌓인 배포를 재설정하려면 반드시 `postgres_data`를
  먼저 백업하십시오.

## 5. 점검표

- archive SHA-256이 외부망 준비 환경의 값과 일치한다.
- 여섯 image가 모두 `linux/amd64`이며 올바른 release tag를 가진다.
- `/login`이 React entry document를 반환한다.
- `/api/health/ready`가 `200 {"status":"ok"}`를 반환한다.
- 기존 `postgres_data`, `redis_data`, `assets_data` volume의 백업이 있다.
- 업로드 mount가 `/app/apps/api/uploads`로 유지된다.
- renderer service 이름과 Keycloak/OpenAI 환경 변수 이름이 유지된다.
- 운영 시작 과정에서 build 또는 registry pull이 발생하지 않는다.
