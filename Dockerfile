# Multi-stage build for the lurq API (serve-http) + operator bin.
#
# Why a Dockerfile instead of Nixpacks: Nixpacks injects every Railway service
# variable as a build-time ARG/ENV, baking secrets (GITHUB_TOKEN, *_API_KEY,
# LURQ_OWNER_KEY, …) into image layers (the SecretsUsedInArgOrEnv warnings). The
# build needs NO secrets — it's just `npm ci` + `tsup`. Here the builder stage
# sees none, and Railway injects secrets at RUNTIME only, so they never enter a
# layer.

# ---- builder: install all deps + bundle (no secrets needed) ----
FROM node:22-slim AS builder
WORKDIR /app

# Copy the repo (workspaces are declared, so the workspace package.json files
# must be present for `npm ci`) and install. Nothing here reads a secret.
COPY . .
RUN npm ci
RUN npm run build

# ---- runtime: only the artifacts the server needs ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Runtime files. packageRoot() walks up to package.json, then resolves
# drizzle/ (migrations) and src/data/seed.json relative to it.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-operator ./dist-operator
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src/data ./src/data

EXPOSE 8080

# Default command; Railway's per-service `startCommand` (railway.serve.json /
# railway.json) overrides this. Secrets arrive via the runtime environment.
CMD ["node", "dist/bin/lurq.js", "serve-http"]
