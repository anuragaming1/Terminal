FROM node:18-bullseye

# Cài đặt packages
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    nano \
    vim \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN ln -s /usr/bin/python3 /usr/bin/python
RUN npm install -g pm2

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Tạo thư mục data với quyền ghi
RUN mkdir -p /app/data /app/workspaces && \
    chmod -R 777 /app/data /app/workspaces

EXPOSE 3000

# Script chạy chính
CMD ["node", "server.js"]
