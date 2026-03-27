FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN npm run build

EXPOSE 5000

CMD ["npm", "start"]
