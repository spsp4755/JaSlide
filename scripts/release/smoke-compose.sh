#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_file="${COMPOSE_FILE:-$repo_root/docker-compose.offline.yml}"
env_file="${ENV_FILE:-$repo_root/.env}"
project_name="${COMPOSE_PROJECT_NAME:-jaslide-smoke}"
base_url="${BASE_URL:-http://127.0.0.1:${WEB_PORT:-3000}}"
timeout_seconds="${SMOKE_TIMEOUT_SECONDS:-180}"
check_only=0
keep_running="${KEEP_RUNNING:-0}"

case "${1:-}" in
  --check-only) check_only=1 ;;
  --keep-running) keep_running=1 ;;
  --help)
    echo "Usage: smoke-compose.sh [--check-only|--keep-running]"
    exit 0
    ;;
  "") ;;
  *)
    echo "Unknown option: $1" >&2
    exit 2
    ;;
esac

cleanup() {
  if [[ "$check_only" == 0 && "$keep_running" != 1 ]]; then
    docker compose --project-name "$project_name" --env-file "$env_file" \
      --file "$compose_file" down --volumes >/dev/null
  fi
}
trap cleanup EXIT

if [[ "$check_only" == 0 ]]; then
  [[ -f "$env_file" ]] || { echo "Missing env file: $env_file" >&2; exit 2; }
  docker compose --project-name "$project_name" --env-file "$env_file" \
    --file "$compose_file" up --detach --no-build --pull never
fi

deadline=$((SECONDS + timeout_seconds))
until ready_body="$(curl --fail --silent --show-error --max-time 3 \
  "$base_url/api/health/ready" 2>/dev/null)" &&
  [[ "$ready_body" == *'"status":"ok"'* ]]; do
  if (( SECONDS >= deadline )); then
    echo "Go API did not become ready within ${timeout_seconds}s" >&2
    exit 1
  fi
  sleep 1
done

login_body="$(curl --fail --silent --show-error --max-time 5 "$base_url/login")"
[[ "$login_body" == *'id="root"'* ]] || {
  echo "/login did not return the React SPA entry document" >&2
  exit 1
}

api_root_body="$(curl --silent --show-error --max-time 5 "$base_url/api")"
[[ "$api_root_body" != *'id="root"'* ]] || {
  echo "/api incorrectly returned the React SPA fallback" >&2
  exit 1
}

echo "Smoke passed: $base_url/login and $base_url/api/health/ready"
