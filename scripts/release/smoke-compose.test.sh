#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture_dir="$(mktemp -d)"
port_file="$fixture_dir/port"
server_log="$fixture_dir/server.log"
docker_log="$fixture_dir/docker.log"

cleanup() {
  if [[ -n "${server_pid:-}" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$fixture_dir"
}
trap cleanup EXIT

mkdir "$fixture_dir/bin"
cat >"$fixture_dir/bin/docker" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$DOCKER_LOG"
SH
chmod +x "$fixture_dir/bin/docker"

if PATH="$fixture_dir/bin:$PATH" DOCKER_LOG="$docker_log" \
  COMPOSE_PROJECT_NAME=jaslide \
  ENV_FILE="$fixture_dir/missing.env" \
  "$repo_root/scripts/release/smoke-compose.sh" >/dev/null 2>&1; then
  echo "smoke accepted an ambient Compose project name" >&2
  exit 1
fi
if [[ -s "$docker_log" ]]; then
  echo "smoke touched Docker while rejecting an ambient Compose project name" >&2
  exit 1
fi

touch "$fixture_dir/ready"

python3 - "$fixture_dir" "$port_file" >"$server_log" 2>&1 <<'PY' &
import http.server
import socketserver
import sys
from pathlib import Path

fixture = Path(sys.argv[1])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/login":
            status, body, content_type = 200, b'<!doctype html><div id="root"></div>\n', "text/html"
        elif self.path == "/api/health/ready" and (fixture / "ready").exists():
            status, body, content_type = 200, b'{"status":"ok"}\n', "application/json"
        elif self.path == "/api" and (fixture / "leak-api-to-spa").exists():
            status, body, content_type = 200, b'<!doctype html><div id="root"></div>\n', "text/html"
        else:
            status, body, content_type = 503, b'{"status":"unavailable"}\n', "application/json"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass

with socketserver.TCPServer(("127.0.0.1", 0), Handler) as server:
    with open(sys.argv[2], "w", encoding="utf-8") as port_file:
        port_file.write(str(server.server_address[1]))
    server.serve_forever()
PY
server_pid=$!

for _ in {1..50}; do
  [[ -s "$port_file" ]] && break
  sleep 0.1
done
[[ -s "$port_file" ]]

BASE_URL="http://127.0.0.1:$(<"$port_file")" \
  "$repo_root/scripts/release/smoke-compose.sh" --check-only

touch "$fixture_dir/leak-api-to-spa"
if BASE_URL="http://127.0.0.1:$(<"$port_file")" \
  "$repo_root/scripts/release/smoke-compose.sh" --check-only >/dev/null 2>&1; then
  echo "smoke check accepted /api leaking to the SPA fallback" >&2
  exit 1
fi
rm "$fixture_dir/leak-api-to-spa"

rm "$fixture_dir/ready"
if BASE_URL="http://127.0.0.1:$(<"$port_file")" \
  SMOKE_TIMEOUT_SECONDS=1 \
  "$repo_root/scripts/release/smoke-compose.sh" --check-only >/dev/null 2>&1; then
  echo "smoke check accepted an unavailable API" >&2
  exit 1
fi
