#!/usr/bin/env bash
set -euo pipefail

release_version="${1:-v0.7.1}"
web_api_url="${VITE_API_URL:-/api}"
output_dir="${OUTPUT_DIR:-dist/release}"
source_date_epoch="${SOURCE_DATE_EPOCH:-$(git log -1 --pretty=%ct 2>/dev/null || printf '0')}"

mkdir -p "$output_dir"

[[ "$release_version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
  echo "Invalid release version: $release_version" >&2
  exit 2
}

build_image() {
  local name="$1"
  local dockerfile="$2"
  shift 2
  docker buildx build \
    --platform linux/amd64 \
    --load \
    --provenance=false \
    --build-arg "SOURCE_DATE_EPOCH=${source_date_epoch}" \
    --file "$dockerfile" \
    --tag "jaslide/${name}:${release_version}" \
    "$@" \
    .
}

build_image core-api docker/core-api.Dockerfile
build_image migrate docker/migrate.Dockerfile
build_image web docker/web.Dockerfile --build-arg "VITE_API_URL=${web_api_url}"
build_image renderer docker/renderer.Dockerfile
build_image postgres docker/postgres.Dockerfile
build_image redis docker/redis.Dockerfile

images=(
  "jaslide/core-api:${release_version}"
  "jaslide/migrate:${release_version}"
  "jaslide/web:${release_version}"
  "jaslide/renderer:${release_version}"
  "jaslide/postgres:${release_version}"
  "jaslide/redis:${release_version}"
)
for image in "${images[@]}"; do
  platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")"
  [[ "$platform" == "linux/amd64" ]] || {
    echo "$image has unexpected platform $platform" >&2
    exit 1
  }
done

archive_path="${output_dir}/jaslide-${release_version}-linux-amd64-images.tar.gz"
archive_work="$(mktemp -d)"
trap 'rm -rf "$archive_work"' EXIT
mkdir "$archive_work/root"
docker image save --output "$archive_work/images.tar" "${images[@]}"
tar --extract --file "$archive_work/images.tar" --directory "$archive_work/root"
# docker image save emits manifest entries in nondeterministic map order.
sed 's/^\[//; s/\]$//; s/},{/}\n{/g' "$archive_work/root/manifest.json" \
  | LC_ALL=C sort > "$archive_work/manifest.entries"
printf '[' > "$archive_work/root/manifest.json"
paste --serial --delimiters=, "$archive_work/manifest.entries" >> "$archive_work/root/manifest.json"
printf ']' >> "$archive_work/root/manifest.json"
tar \
  --sort=name \
  --mtime="@${source_date_epoch}" \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --create \
  --file=- \
  --directory="$archive_work/root" \
  . | gzip -n -9 > "${archive_path}.tmp"
mv "${archive_path}.tmp" "$archive_path"

(
  cd "$output_dir"
  archive_name="$(basename "$archive_path")"
  if command -v sha256sum >/dev/null; then
    sha256sum "$archive_name" > "${archive_name}.sha256"
  else
    shasum -a 256 "$archive_name" > "${archive_name}.sha256"
  fi
)
echo "Created $archive_path"
