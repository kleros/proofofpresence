FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# Source-only changes must not invalidate the large production dependency layer.
FROM deps AS production-deps
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

# Keep the exact pinned compilers available for the existing build checks.
FROM deps AS build
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/build.mjs ./scripts/build.mjs
COPY scripts/compile-contracts.mjs ./scripts/compile-contracts.mjs
COPY scripts/compile-contracts-v9.mjs ./scripts/compile-contracts-v9.mjs
COPY scripts/compile-contracts-v10.mjs ./scripts/compile-contracts-v10.mjs
COPY scripts/verify-metamask-v1.3-runtime.mjs ./scripts/verify-metamask-v1.3-runtime.mjs
COPY scripts/mainnet/ ./scripts/mainnet/
COPY scripts/compile-contracts-test15m.mjs scripts/generate-contracts-test15m.mjs ./scripts/
COPY contracts/ ./contracts/
COPY registry/ ./registry/
COPY references/kickback/scripts/ ./references/kickback/scripts/
COPY references/kickback/contracts/ ./references/kickback/contracts/
COPY references/kickback/abi/ ./references/kickback/abi/
COPY references/kickback/test/*.sol ./references/kickback/test/
COPY references/kickback/site/index.html ./references/kickback/site/index.html
COPY references/kickback/console/index.html ./references/kickback/console/index.html
COPY references/kickback/docs/metaevidence.event-v1.template.json ./references/kickback/docs/metaevidence.event-v1.template.json
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production MODE=hosted-demo RPC_PORT=0 RUNTIME_ROOT=/app/.runtime
WORKDIR /app
COPY --from=production-deps --chown=node:node /app/node_modules/ ./node_modules/
COPY --from=production-deps --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/src/ ./src/
COPY --from=build --chown=node:node /app/public/ ./public/
COPY --from=build --chown=node:node /app/contracts/ ./contracts/
COPY --from=build --chown=node:node /app/build/ ./build/
COPY --from=build --chown=node:node /app/registry/ ./registry/
COPY --from=build --chown=node:node /app/references/kickback/ ./references/kickback/
COPY --from=build --chown=node:node /app/scripts/ ./scripts/
COPY --from=build --chown=node:node /app/artifacts/ ./artifacts/
COPY --chown=node:node artifacts/v10-integration/metamask-source-verification-6ea176ca-3ea1-49eb-a290-1013d6492a15.json ./artifacts/v10-integration/metamask-source-verification-6ea176ca-3ea1-49eb-a290-1013d6492a15.json
COPY --chown=node:node artifacts/v10-integration/metamask-runtime-observed.json ./artifacts/v10-integration/metamask-runtime-observed.json
COPY --chown=node:node artifacts/v10-integration/eip7702/2026-10-29T16-40-03.581Z-d5123ece-de5d-4d69-a5a0-1d5a2236535c/proof.json ./artifacts/v10-integration/eip7702/2026-10-29T16-40-03.581Z-d5123ece-de5d-4d69-a5a0-1d5a2236535c/proof.json
COPY --chown=node:node artifacts/v10-integration/type4-protected/2026-10-29T17-19-46.899Z-0d5838d5-4291-4ba5-990d-e72bba6a65e8/proof.json ./artifacts/v10-integration/type4-protected/2026-10-29T17-19-46.899Z-0d5838d5-4291-4ba5-990d-e72bba6a65e8/proof.json
COPY --chown=node:node test/v10-eip7702.e2e.mjs test/v10-type4-protected.e2e.mjs ./test/
RUN mkdir -p /app/.runtime && chown node:node /app /app/.runtime
USER node
EXPOSE 3000
CMD ["node", "src/container.mjs"]
