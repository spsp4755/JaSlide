# 폐쇄망 배포

폐쇄망에서는 소스 빌드나 패키지 설치를 수행하지 않습니다. Node, Python, APT 패키지와 컨테이너 기반 이미지는 모두 외부망 준비 환경에서 검증한 뒤 반입합니다.

## 1. 외부망 준비 환경

신뢰하는 커밋과 lockfile에서 이미지를 빌드합니다. 이 단계만 네트워크 접근이 필요합니다.

`linux/amd64` 이미지는 빌드 PC의 CPU와 무관하게 명시적으로 생성합니다. 웹은 기본적으로 동일 Ingress의 상대 경로 `/api`를 사용하므로 사내 도메인을 이미지에 고정하지 않습니다.

```bash
./scripts/release/build-amd64-images.sh v0.4.0
# dist/release/jaslide-v0.4.0-linux-amd64-images.tar.gz
# dist/release/jaslide-v0.4.0-linux-amd64-images.tar.gz.sha256
```

개발 또는 빌드 재현용 pnpm 저장소를 함께 전달해야 한다면, 신뢰하는 lockfile과 준비된 저장소를 사용합니다.

```bash
pnpm fetch --frozen-lockfile --trust-lockfile --store-dir ./pnpm-store
tar -czf jaslide-pnpm-store.tar.gz pnpm-store
```

`--trust-lockfile`은 검토·서명된 lockfile에만 사용합니다. 이 옵션은 pnpm의 공급망 재검증으로 인한 레지스트리 조회를 막습니다.

## 2. 폐쇄망 반입 및 실행

1. `jaslide-v0.4.0-linux-amd64-images.tar.gz`와 SHA-256 파일을 반입해 무결성을 확인합니다.
2. Kubernetes/Harbor 배포 환경에서는 Podman으로 로드한 뒤 Harbor에 푸시합니다. 실제 태그·푸시·`kubectl apply -k` 절차는 [Kubernetes 배포 문서](deployment.md#kubernetes--harbor-closed-network)를 따릅니다.

```bash
shasum -a 256 -c jaslide-v0.4.0-linux-amd64-images.tar.gz.sha256
podman load -i jaslide-v0.4.0-linux-amd64-images.tar.gz
podman image inspect jaslide/api:v0.4.0 jaslide/web:v0.4.0 jaslide/renderer:v0.4.0 jaslide/postgres:v0.4.0 jaslide/redis:v0.4.0
podman image inspect --format '{{.Architecture}}' jaslide/api:v0.4.0  # amd64
```

`docker-compose.offline.yml`은 개발·스모크 테스트 전용이며 Docker 이미지 저장소를 사용합니다. Podman으로 로드한 이미지를 Docker Compose에 섞어 사용하지 않습니다. Compose 검증이 필요하면 별도의 Docker 환경에서 같은 아카이브를 `docker load -i`로 로드한 뒤 `jaslide/*:v0.4.0`을 `jaslide/*:offline`으로 태그하십시오. Compose 파일에는 `build:` 항목이 없습니다.

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
- Podman 이미지 5개가 모두 `podman image inspect`에 존재하고 아키텍처가 `amd64`이다.
- `docker compose ... up -d --no-build` 중 외부 DNS/레지스트리 요청이 없다.
- 업로드 저장소, PostgreSQL, Redis 볼륨의 백업 정책이 적용되어 있다.
