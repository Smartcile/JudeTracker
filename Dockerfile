# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/server/drizzle ./server/drizzle
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/shared ./shared
COPY --from=build /app/server/tsconfig.json ./server/tsconfig.json
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /app/README.md ./README.md
COPY --from=build /app/client/dist ./client/dist
EXPOSE 8090
CMD ["npm", "run", "start"]
