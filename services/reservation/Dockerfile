# Monorepo build. The build context is the REPOSITORY ROOT, not this folder,
# because the image also needs libs/. See docs/monorepo.md.
#
#   docker build -f services/reservation/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY libs/shared/package.json libs/shared/
COPY libs/nest-support/package.json libs/nest-support/
COPY services/reservation/package.json services/reservation/
RUN npm ci

COPY libs/shared libs/shared
COPY libs/nest-support libs/nest-support
COPY services/reservation services/reservation
RUN npm run build -w @flashtix/shared \
 && npm run build -w @flashtix/nest-support \
 && npm run build -w @flashtix/reservation

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY libs/shared/package.json libs/shared/
COPY libs/nest-support/package.json libs/nest-support/
COPY services/reservation/package.json services/reservation/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/libs/shared/dist libs/shared/dist
COPY --from=build /app/libs/nest-support/dist libs/nest-support/dist
COPY --from=build /app/services/reservation/dist services/reservation/dist
# LockHold contract, loaded at runtime by the gRPC server (RES-4).
COPY proto proto

USER node
EXPOSE 3000 50051
CMD ["node", "services/reservation/dist/main.js"]
