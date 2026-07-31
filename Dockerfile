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

EXPOSE 3001

CMD ["node", "server/index.js"]
