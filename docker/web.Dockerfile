FROM node:22-bookworm-slim AS base

# Install pnpm
RUN npm install -g pnpm@11.7.0

WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Copy root package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY turbo.json ./

# Copy packages
COPY packages ./packages

# Copy web app
COPY apps/web ./apps/web
# Local Korean font assets used by next/font/local
COPY apps/api/src/assets/fonts ./apps/api/src/assets/fonts

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared packages
RUN pnpm --filter @jaslide/shared build

# Build Next.js app
RUN pnpm --filter @jaslide/web build

# Production stage
FROM node:22-bookworm-slim AS production

ARG NEXT_PUBLIC_API_URL

RUN npm install -g pnpm@11.7.0

WORKDIR /app

COPY --from=base /app ./

WORKDIR /app/apps/web

EXPOSE 3000

ENV NODE_ENV=production
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

CMD ["pnpm", "start"]
