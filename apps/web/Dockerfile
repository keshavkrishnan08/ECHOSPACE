FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @echospace/web exec next build --webpack

FROM node:22-alpine
WORKDIR /repo
RUN corepack enable
COPY --from=build /repo /repo
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@echospace/web", "start"]
