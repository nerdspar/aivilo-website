# syntax=docker/dockerfile:1

# ---------- Stage 1: prerender the static site ----------
FROM node:22-alpine AS build
WORKDIR /app

# SITE_URL is baked into canonical URLs, sitemap.xml, OG tags and JSON-LD.
# Override at build time: docker build --build-arg SITE_URL=https://your.domain ...
ARG SITE_URL=https://aivilo.nerdspar.com
ENV SITE_URL=${SITE_URL}

COPY build ./build
COPY site ./site
RUN node build/prerender.mjs

# ---------- Stage 2: serve with nginx (non-root) ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# Metadata (OCI labels)
LABEL org.opencontainers.image.title="Aivilo Website" \
      org.opencontainers.image.description="Aivilo marketing site — static, prerendered, served by nginx" \
      org.opencontainers.image.source="https://github.com/nerdspar/aivilo-website"

# Replace the default server config with ours, and fail the build if it's invalid
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
RUN nginx -t

# Copy the prerendered site
COPY --from=build /app/dist /usr/share/nginx/html

# The base image already runs as uid 101 (nginx) and exposes 8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
