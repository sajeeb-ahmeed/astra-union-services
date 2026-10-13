FROM node:24-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-schemas/package.json packages/shared-schemas/package.json
RUN npm ci --no-audit --no-fund && npx playwright install --with-deps chromium && apt-get update && apt-get install -y --no-install-recommends fonts-noto-core && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm run build && mkdir -p /app/.runtime && chown -R node:node /app/.runtime /opt/playwright
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
EXPOSE 3001
CMD ["node","--import","tsx","apps/api/src/server.ts"]
