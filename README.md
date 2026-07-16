# Aivilo Website

The Aivilo marketing site — a fast, SEO-optimized **static** website. The single-file
source in [`site/index.html`](site/index.html) is prerendered at build time into one
clean-URL HTML page per route, packaged into a small nginx container, built by GitHub
Actions, and served from TrueNAS behind a Cloudflare Tunnel.

```
GitHub push ──▶ GitHub Actions ──▶ GHCR image ──▶ TrueNAS (docker compose) ──▶ Cloudflare Tunnel ──▶ https://aivilo.nerdspar.com
```

## Pages / routes

| URL | File served |
|-----|-------------|
| `/` | `dist/index.html` |
| `/platform` | `dist/platform/index.html` |
| `/services` | `dist/services/index.html` |
| `/partners` | `dist/partners/index.html` |
| `/company` | `dist/company/index.html` |
| `/contact` | `dist/contact/index.html` |
| (any unknown) | `dist/404.html` |

Each page is a real, independently-indexable URL with its own `<title>`, meta
description, canonical link, Open Graph/Twitter tags, and JSON-LD. `sitemap.xml`,
`robots.txt`, `favicon.svg`, and `og-image.svg` are generated/copied into `dist/`.

## Repository layout

```
site/index.html          # single source of truth (all content lives here)
site/favicon.svg          # brand mark
site/og-image.svg         # social share image
build/prerender.mjs       # zero-dep build: splits source into per-route pages + sitemap/robots
build/serve.mjs           # zero-dep local preview server (mimics nginx clean URLs)
nginx/default.conf        # nginx config: gzip, security headers/CSP, clean URLs, /healthz
Dockerfile                # multi-stage: Node prerender -> nginx (non-root, :8080)
docker-compose.yml        # TrueNAS deploy stack (web + optional cloudflared sidecar)
.env.example              # CLOUDFLARE_TUNNEL_TOKEN template
.github/workflows/        # CI: build & push image to GHCR
```

To edit the site, change [`site/index.html`](site/index.html) and rebuild. All six
views live inside that one file (each `<section class="view" id="view-…">`).

---

## Local development

Requires Node 18+ (no dependencies to install).

```bash
node build/prerender.mjs   # generate dist/
node build/serve.mjs       # preview at http://localhost:4321
```

Or with Docker (matches production exactly):

```bash
docker build -t aivilo-website .
docker run --rm -p 8080:8080 aivilo-website
# open http://localhost:8080
```

---

## CI/CD — GitHub Actions → GHCR

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) builds
and pushes a container image to the GitHub Container Registry (GHCR) on every push to
`main` and on `v*.*.*` tags. Pull requests build but do not push.

**Image:** `ghcr.io/nerdspar/aivilo-website`
**Tags:** `latest` (main), `main`, `sha-<short>`, and `vX.Y.Z` / `vX.Y` for release tags.

No secrets to configure — it uses the built-in `GITHUB_TOKEN`. After the first
successful run, the image appears under the repo's **Packages**.

### Make the image pullable by TrueNAS

GHCR packages are **private** by default. Easiest path for a public marketing site:

1. GitHub → your profile/org → **Packages** → `aivilo-website` → **Package settings**
2. **Change visibility → Public**

(The image only contains a public website.) If you prefer to keep it private, create a
GitHub Personal Access Token with `read:packages` and add it as a registry credential
in TrueNAS (**Apps → Settings → Manage Container Images / Docker Hub Registry**), using
username `nerdspar` and the token as the password against `ghcr.io`.

### Point the build at a different domain

`SITE_URL` is baked into canonical URLs, `sitemap.xml`, OG tags, and JSON-LD. Default:
`https://aivilo.nerdspar.com`. To change it **without editing code**, add a repository
variable (Settings → Secrets and variables → Actions → **Variables**) named `SITE_URL`,
e.g. `https://aivilo.ai`. Then re-run the workflow. Locally: `SITE_URL=https://aivilo.ai
node build/prerender.mjs` or `docker build --build-arg SITE_URL=https://aivilo.ai .`

---

## Deploy on TrueNAS SCALE

TrueNAS SCALE (Electric Eel 24.10+) runs Docker Compose apps directly.

### Option A — Custom App (paste YAML)

1. **Apps → Discover Apps → Custom App** (top-right) → **Install via YAML**.
2. Paste the contents of [`docker-compose.yml`](docker-compose.yml).
3. Replace `${CLOUDFLARE_TUNNEL_TOKEN:?...}` in the `cloudflared` service with your
   actual tunnel token (TrueNAS YAML has no `.env` substitution, so the token must
   be inline). Don't want the tunnel? Delete the whole `cloudflared` service.
4. **Install**, then confirm **two** containers start (`aivilo-website` and
   `aivilo-cloudflared`).

### Option B — Docker Compose CLI (if you use the shell)

```bash
cp .env.example .env         # then paste your tunnel token into .env
docker compose pull
docker compose up -d         # starts web + Cloudflare Tunnel sidecar
```

The container serves on port **8080** and has a `/healthz` endpoint for health checks.

### Updating to a new build

```bash
docker compose pull && docker compose up -d
```

or in the TrueNAS UI, open the app and **Update** / pull the latest image. (Consider
watchtower or a scheduled pull if you want auto-updates.)

---

## Cloudflare Tunnel

Two ways to expose the site publicly at `aivilo.nerdspar.com` — no ports forwarded on
your router.

### Recommended: cloudflared sidecar (included in the compose)

1. Cloudflare **Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflared type).
2. Name it (e.g. `aivilo`), then copy the **token** from the Docker install command
   (the long `eyJ…` string after `--token`).
3. Put it in `.env` as `CLOUDFLARE_TUNNEL_TOKEN=…` (Option B) or paste it into the YAML
   (Option A), then deploy. The `cloudflared` container connects on start — check its
   logs for `Registered tunnel connection`; the tunnel then shows **HEALTHY** in the
   dashboard. (`Unauthorized` / `invalid tunnel token` = the token was mangled.)
4. Back in the tunnel's **Public Hostnames**, add:
   - **Subdomain/Domain:** `aivilo` / `nerdspar.com`
   - **Service:** `HTTP` → `web:8080`  ← the sidecar reaches the site over the
     compose network by service name; no host port needed.
5. Cloudflare creates the DNS record automatically. Visit `https://aivilo.nerdspar.com`.

When you use the sidecar, you can delete the `ports:` block from the `web` service so
the site is reachable **only** through the tunnel.

### Alternative: an existing cloudflared on your network

If you already run a tunnel elsewhere, skip the sidecar and point a public hostname at
this host's published port, e.g. **Service:** `http://<truenas-ip>:8080`. Keep the
`ports: "8080:8080"` mapping in that case.

---

## SEO notes

- **Distinct indexable pages** — each route is prerendered to its own HTML with a unique
  title/description/canonical (no hash-fragment SPA URLs).
- **Structured data** — Organization + WebSite + SoftwareApplication on every page, plus
  a FAQPage on `/platform`. Validate with Google's
  [Rich Results Test](https://search.google.com/test/rich-results).
- **sitemap.xml / robots.txt** — generated with the correct `SITE_URL`; submit the
  sitemap in Google Search Console once the domain is live.
- **Performance** — static files, gzip, long-cache assets, no render-blocking JS.
- **Social image** — `og-image.svg` is an SVG. Most platforms preview it, but some
  (Facebook/LinkedIn) prefer PNG/JPG; drop a `1200×630` `og-image.png` in `site/` and
  update the `og:image` reference if you want maximum compatibility.

## Content notes

The metrics, logos, and testimonial in the site are illustrative placeholders from the
design. Swap them for real figures before any public launch. The contact form is a
front-end demo (`onsubmit` shows a success state); wire it to a real endpoint
(e.g. a Cloudflare Worker, Formspree, or your CRM) when ready.
