# Monorepo build. The build context is the REPOSITORY ROOT, not this folder,
# because the image needs libs/shared as well. See docs/monorepo.md.
#
#   docker build -f tools/payment-gateway-mock/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app

# Manifests first, so npm ci is cached while only sources change.
COPY package.json package-lock.json tsconfig.base.json ./
COPY libs/shared/package.json libs/shared/
COPY tools/payment-gateway-mock/package.json tools/payment-gateway-mock/
RUN npm ci

COPY libs/shared libs/shared
COPY tools/payment-gateway-mock tools/payment-gateway-mock
RUN npm run build -w @flashtix/shared \
 && npm run build -w @flashtix/payment-gateway-mock

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY libs/shared/package.json libs/shared/
COPY tools/payment-gateway-mock/package.json tools/payment-gateway-mock/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/libs/shared/dist libs/shared/dist
COPY --from=build /app/tools/payment-gateway-mock/dist tools/payment-gateway-mock/dist

USER node
EXPOSE 8080
CMD ["node", "tools/payment-gateway-mock/dist/main.js"]
