FROM postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297

# Fresh databases receive the existing schema without carrying a Node runtime.
# Existing PostgreSQL volumes skip initdb and remain untouched.
COPY apps/api/prisma/migrations /opt/jaslide/migrations
RUN { \
      echo 'set -eu'; \
      echo 'for migration in /opt/jaslide/migrations/*/migration.sql; do'; \
      echo '  psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --file "$migration"'; \
      echo 'done'; \
    } > /docker-entrypoint-initdb.d/10-jaslide-schema.sh \
    && chmod +x /docker-entrypoint-initdb.d/10-jaslide-schema.sh
