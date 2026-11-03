# Build from the repository root so the shared packages are in the build context:
#   docker build -f apps/shopify/Dockerfile -t centurion-shopify .
# Runtime needs DATABASE_URL (Postgres, also used for Shopify sessions), SHOPIFY_API_KEY,
# SHOPIFY_API_SECRET, SHOPIFY_APP_URL and SCOPES.
FROM node:22-alpine
RUN apk add --no-cache openssl

ENV NODE_ENV=production

# The app links packages/core with a file: dependency, and core imports packages/attribution
# by relative path, so all three keep their repository layout under /repo.
WORKDIR /repo

COPY packages/attribution/package.json packages/attribution/package-lock.json packages/attribution/
COPY packages/core/package.json packages/core/package-lock.json packages/core/
COPY apps/shopify/package.json apps/shopify/package-lock.json apps/shopify/

RUN cd packages/attribution && npm ci --omit=dev \
  && cd ../core && npm ci --omit=dev \
  && cd ../../apps/shopify && npm ci --omit=dev \
  && npm cache clean --force

COPY packages/attribution packages/attribution
COPY packages/core packages/core
COPY apps/shopify apps/shopify

WORKDIR /repo/apps/shopify
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
