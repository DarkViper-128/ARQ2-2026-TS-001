# Monorepo build. The build context is the REPOSITORY ROOT, not this folder,
# because the image also needs libs/. See docs/monorepo.md.
#
#   docker build -f services/catalog/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY libs/shared/package.json libs/shared/
COPY libs/nest-support/package.json libs/nest-support/
COPY services/catalog/package.json services/catalog/
RUN npm ci

COPY libs/shared libs/shared
COPY libs/nest-support libs/nest-support
COPY services/catalog services/catalog
RUN npm run build -w @flashtix/shared \
 && npm run build -w @flashtix/nest-support \
 && npm run build -w @flashtix/catalog

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY libs/shared/package.json libs/shared/
COPY libs/nest-support/package.json libs/nest-support/
COPY services/catalog/package.json services/catalog/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/libs/shared/dist libs/shared/dist
COPY --from=build /app/libs/nest-support/dist libs/nest-support/dist
COPY --from=build /app/services/catalog/dist services/catalog/dist

USER node
EXPOSE 3000
CMD ["node", "services/catalog/dist/main.js"]
