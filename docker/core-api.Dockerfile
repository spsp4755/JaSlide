FROM golang:1.24-bookworm AS build

WORKDIR /src
COPY apps/core-api/go.mod apps/core-api/go.sum ./
RUN go mod download
COPY apps/core-api ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/core-api ./cmd/api

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/apps/api/uploads

ENV LOCAL_STORAGE_PATH=/app/apps/api/uploads
WORKDIR /app
COPY --from=build /out/core-api ./core-api

EXPOSE 4000
CMD ["./core-api"]
