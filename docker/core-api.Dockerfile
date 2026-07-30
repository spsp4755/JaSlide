FROM --platform=$BUILDPLATFORM golang:1.24.12-bookworm@sha256:322a794c4289ad86e3043e5d9f16ead790463658a1bd2c3983427f02983ab978 AS build

WORKDIR /src
COPY apps/core-api/go.mod apps/core-api/go.sum ./
RUN go mod download
COPY apps/core-api ./
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/core-api ./cmd/api

FROM debian:bookworm-20250721-slim@sha256:2424c1850714a4d94666ec928e24d86de958646737b1d113f5b2207be44d37d8

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/apps/api/uploads

ENV LOCAL_STORAGE_PATH=/app/apps/api/uploads
WORKDIR /app
COPY --from=build /out/core-api ./core-api

EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
    CMD curl --fail --silent http://127.0.0.1:4000/api/health/ready || exit 1
CMD ["./core-api"]
