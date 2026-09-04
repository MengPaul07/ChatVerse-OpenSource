FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages packages
COPY apps apps
COPY frontend frontend
COPY docs docs

RUN npm ci
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=build /app/packages packages
COPY --from=build /app/apps apps
COPY --from=build /app/frontend/dist frontend/dist

RUN npm ci --omit=dev

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
CMD ["npm", "run", "start"]
