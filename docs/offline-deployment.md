# 폐쇄망 배포

폐쇄망에서는 소스 빌드나 패키지 설치를 수행하지 않습니다. Node, Python, APT 패키지와 컨테이너 기반 이미지는 모두 외부망 준비 환경에서 검증한 뒤 반입합니다.

## 1. 외부망 준비 환경

신뢰하는 커밋과 lockfile에서 이미지를 빌드합니다. 이 단계만 네트워크 접근이 필요합니다.

```bash
docker build -f docker/api.Dockerfile -t jaslide/api:offline .
docker build -f docker/web.Dockerfile -t jaslide/web:offline .
docker build -f docker/renderer.Dockerfile -t jaslide/renderer:offline .
docker pull postgres:16-alpine
docker pull redis:7-alpine
docker save -o jaslide-offline-images.tar \
  jaslide/api:offline jaslide/web:offline jaslide/renderer:offline \
  postgres:16-alpine redis:7-alpine
sha256sum jaslide-offline-images.tar > jaslide-offline-images.tar.sha256
```

개발 또는 빌드 재현용 pnpm 저장소를 함께 전달해야 한다면, 신뢰하는 lockfile과 준비된 저장소를 사용합니다.

```bash
pnpm fetch --frozen-lockfile --trust-lockfile --store-dir ./pnpm-store
tar -czf jaslide-pnpm-store.tar.gz pnpm-store
```

`--trust-lockfile`은 검토·서명된 lockfile에만 사용합니다. 이 옵션은 pnpm의 공급망 재검증으로 인한 레지스트리 조회를 막습니다.

## 2. 폐쇄망 반입 및 실행

1. `jaslide-offline-images.tar`와 SHA-256 파일을 반입해 무결성을 확인합니다.
2. 이미지를 로드하고 필요한 `.env`를 제공합니다. AI 서버를 사내에서 운영하는 경우 `OPENAI_BASE_URL`에 그 내부 주소를 설정합니다.
3. 전용 Compose 파일을 **빌드 없이** 실행합니다.

```bash
sha256sum -c jaslide-offline-images.tar.sha256
docker load -i jaslide-offline-images.tar
docker image inspect jaslide/api:offline jaslide/web:offline jaslide/renderer:offline postgres:16-alpine redis:7-alpine
docker compose --env-file .env -f docker-compose.offline.yml up -d --no-build
docker compose --env-file .env -f docker-compose.offline.yml ps
```

`docker-compose.offline.yml`에는 `build:` 항목이 없습니다. 누락된 이미지를 외부에서 받거나 Dockerfile 안에서 패키지를 설치하지 않습니다.

## 3. 폐쇄망에서 소스 빌드가 필요한 경우

준비 단계에서 반입한 pnpm 저장소를 지정해 설치합니다. 빈 저장소나 기본 저장소를 사용하면 pnpm이 레지스트리에 접근하려 하므로 금지합니다.

```bash
CI=true pnpm install --offline --frozen-lockfile --trust-lockfile --store-dir /opt/jaslide/pnpm-store
```

이 명령은 `downloaded 0`을 출력해야 합니다. 이후 Prisma 클라이언트를 로컬에서 생성하고 빌드합니다.

```bash
cd apps/api
./node_modules/.bin/prisma generate --schema prisma/schema.prisma
./node_modules/.bin/nest build
cd ../web
./node_modules/.bin/next build
```

## 4. 배포 전 점검

- 로컬 LLM 엔드포인트와 모델 파일이 사내에 준비되어 있다.
- 이미지 tarball SHA-256이 준비 환경의 값과 일치한다.
- Docker 이미지 5개가 모두 `docker image inspect`에 존재한다.
- `docker compose ... up -d --no-build` 중 외부 DNS/레지스트리 요청이 없다.
- 업로드 저장소, PostgreSQL, Redis 볼륨의 백업 정책이 적용되어 있다.
