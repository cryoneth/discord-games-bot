# ── Build ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY activity ./activity
COPY assets ./assets
RUN npm run build && npm prune --omit=dev --ignore-scripts
# Smoke test: the native canvas binary loads on Alpine and the fonts are found.
RUN node --input-type=module -e "const { celebrationGif } = await import('./dist/render/animate.js'); const { bannerScene } = await import('./dist/render/boards.js'); const s = bannerScene('OK', 'render check', '#fff'); const b = celebrationGif(s.draw, s.w, s.h, 2); if (b.subarray(0, 6).toString() !== 'GIF89a') process.exit(1); console.log('render check ok', b.length);"

# ── Runtime ────────────────────────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
