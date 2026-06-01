FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# 書き込みディレクトリを作成（存在しない場合）
RUN mkdir -p /app/public/uploads /app/data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
