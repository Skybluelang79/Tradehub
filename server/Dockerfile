FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p uploads logs

EXPOSE 3001

VOLUME ["/app/uploads", "/app/logs"]

CMD ["node", "index.js"]
