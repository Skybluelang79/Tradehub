FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3001

RUN mkdir -p uploads logs

CMD ["node", "index.js"]
