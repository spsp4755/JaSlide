#!/usr/bin/env bash
set -euo pipefail

release_version="${1:-v0.2.0}"
web_api_url="${NEXT_PUBLIC_API_URL:-/api}"
output_dir="${OUTPUT_DIR:-dist/release}"

mkdir -p "$output_dir"

docker buildx build --platform linux/amd64 --load -f docker/api.Dockerfile -t "jaslide/api:${release_version}" .
docker buildx build --platform linux/amd64 --load -f docker/web.Dockerfile -t "jaslide/web:${release_version}" --build-arg "NEXT_PUBLIC_API_URL=${web_api_url}" .
docker buildx build --platform linux/amd64 --load -f docker/renderer.Dockerfile -t "jaslide/renderer:${release_version}" .
docker buildx build --platform linux/amd64 --load -f docker/postgres.Dockerfile -t "jaslide/postgres:${release_version}" .
docker buildx build --platform linux/amd64 --load -f docker/redis.Dockerfile -t "jaslide/redis:${release_version}" .

archive_path="${output_dir}/jaslide-${release_version}-linux-amd64-images.tar.gz"
docker image save \
  "jaslide/api:${release_version}" \
  "jaslide/web:${release_version}" \
  "jaslide/renderer:${release_version}" \
  "jaslide/postgres:${release_version}" \
  "jaslide/redis:${release_version}" | gzip -9 > "$archive_path"

shasum -a 256 "$archive_path" > "${archive_path}.sha256"
echo "Created $archive_path"
