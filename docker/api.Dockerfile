FROM node:22-bookworm-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@11.7.0

WORKDIR /app

# Copy root package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY turbo.json ./

# Copy packages
COPY packages ./packages

# Copy api app
COPY apps/api ./apps/api

# Install dependencies
RUN pnpm install --frozen-lockfile --trust-lockfile

# Generate Prisma client
WORKDIR /app/apps/api
RUN pnpm db:generate

# Build shared packages
WORKDIR /app
RUN pnpm --filter @jaslide/shared build

# Build API
RUN pnpm --filter @jaslide/api build

# Production stage
FROM node:22-bookworm-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.7.0

WORKDIR /app

COPY --from=base /app ./

WORKDIR /app/apps/api

EXPOSE 4000

CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm start:prod"]
