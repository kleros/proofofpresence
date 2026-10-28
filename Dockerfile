FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/build.mjs ./scripts/build.mjs
COPY scripts/compile-contracts.mjs ./scripts/compile-contracts.mjs
COPY contracts/ ./contracts/
COPY registry/ ./registry/
COPY references/kickback/scripts/ ./references/kickback/scripts/
COPY references/kickback/contracts/ ./references/kickback/contracts/
COPY references/kickback/abi/ ./references/kickback/abi/
COPY references/kickback/test/*.sol ./references/kickback/test/
COPY references/kickback/site/index.html ./references/kickback/site/index.html
COPY references/kickback/console/index.html ./references/kickback/console/index.html
COPY references/kickback/docs/metaevidence.event-v1.template.json ./references/kickback/docs/metaevidence.event-v1.template.json
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim
ENV NODE_ENV=production MODE=hosted-demo RPC_PORT=0 RUNTIME_ROOT=/app/.runtime
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.runtime && chown node:node /app /app/.runtime
USER node
EXPOSE 3000
CMD ["node", "src/container.mjs"]
