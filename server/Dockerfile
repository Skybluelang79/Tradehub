FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p uploads logs \
  && chown -R node:node . \
  && chmod 755 .

USER node

EXPOSE 3001

VOLUME ["/app/uploads", "/app/logs"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health > /dev/null 2>&1 || exit 1

CMD ["node", "index.js"]
