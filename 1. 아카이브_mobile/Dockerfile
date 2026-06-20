FROM node:20-alpine

WORKDIR /app

# 의존성 먼저 설치 (캐시 레이어 활용)
COPY package*.json ./
RUN npm ci --omit=dev

# 앱 소스 복사
COPY public/ ./public/

# Fly.io 볼륨 마운트 포인트 생성
RUN mkdir -p /data

EXPOSE 8080

CMD ["node", "public/server.js"]
