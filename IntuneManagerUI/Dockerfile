# =============================================================================
# Multi-stage Dockerfile for IntuneManager web deployment
# Build context: ./IntuneManagerUI
#
# Produces a Debian Linux container (node:20-slim) with:
#   - React SPA served as static files by Express
#   - Express API on port 8080
#   - PowerShell 7 (pwsh) for the PS bridge
# =============================================================================

# ── Stage 1: Build React SPA ──────────────────────────────────────────────────
FROM node:20-slim AS spa-builder
WORKDIR /build

COPY package.json ./
# --ignore-scripts skips the postinstall electron-rebuild (not needed for web)
RUN npm install --ignore-scripts

COPY src/ ./src/
COPY vite.config.ts tsconfig.json tsconfig.node.json index.html ./

RUN npm run build
# Output: /build/builds/dist-web/

# ── Stage 2: Compile Express server ──────────────────────────────────────────
FROM node:20-slim AS server-builder
WORKDIR /build/server

COPY server/package.json ./
RUN npm install

COPY server/ ./

# Generate Prisma client for Linux (debian-openssl-3.0.x matches node:20-slim / Debian 12)
# DATABASE_URL not required at generate time — only at query time
RUN npx prisma generate

# Compile TypeScript → dist/
RUN npm run build
# Output: /build/server/dist/

# ── Stage 3: Runtime image ────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

# Install PowerShell 7 (pwsh) — required for ps-bridge.ts spawn('pwsh', ...)
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget \
        apt-transport-https \
        ca-certificates \
    && wget -q "https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb" -O /tmp/ms-prod.deb \
    && dpkg -i /tmp/ms-prod.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends powershell \
    && rm -rf /var/lib/apt/lists/* /tmp/ms-prod.deb

# Install WinTuner PS module (Get-WtWin32Apps, New-WtWingetPackage, Deploy-WtWin32App, etc.)
RUN pwsh -NonInteractive -Command \
    "Set-PSRepository PSGallery -InstallationPolicy Trusted; \
     Install-Module -Name WinTuner -Scope AllUsers -Force -AllowClobber"

# Copy compiled server — preserve structure so __dirname path resolution works:
# node server/dist/index.js → __dirname = /app/server/dist
# path.join(__dirname, '..', '..', 'builds', 'dist-web') = /app/builds/dist-web ✓
COPY --from=server-builder /build/server/dist/         ./server/dist/
COPY --from=server-builder /build/server/node_modules/ ./server/node_modules/
COPY --from=server-builder /build/server/prisma/       ./server/prisma/
COPY --from=server-builder /build/server/package.json  ./server/package.json

# Copy PS bridge scripts into the compiled server tree so __dirname resolution works.
# ps-bridge.ts compiles to dist/services/ps-bridge.js → __dirname = /app/server/dist/services
# path.join(__dirname, '..', 'ps-scripts') → /app/server/dist/ps-scripts
COPY server/ps-scripts/ ./server/dist/ps-scripts/

# Copy React SPA (served as static files by Express in production)
COPY --from=spa-builder /build/builds/dist-web/ ./builds/dist-web/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server/dist/index.js"]
