FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server

RUN mkdir -p server/uploads server/logs \
  && chown -R node:node server \
  && chmod 755 server

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health > /dev/null 2>&1 || exit 1

CMD ["node", "server/index.js"]
