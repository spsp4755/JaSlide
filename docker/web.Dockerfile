FROM node:22-bookworm-slim AS build

RUN npm install -g pnpm@11.7.0
WORKDIR /app

ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/api/src/assets/fonts ./apps/api/src/assets/fonts

RUN pnpm install --frozen-lockfile --trust-lockfile
RUN pnpm --filter @jaslide/shared build
RUN pnpm --filter @jaslide/web build

FROM nginx:1.27-alpine AS production

COPY docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
