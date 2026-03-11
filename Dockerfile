FROM node:18-slim  # Dùng slim thay vì bullseye đầy đủ

# Cài đặt chỉ những gói thực sự cần
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    nano \
    && rm -rf /var/lib/apt/lists/*

# Tạo symlink
RUN ln -s /usr/bin/python3 /usr/bin/python
RUN ln -s /usr/bin/pip3 /usr/bin/pip

# Cài đặt PM2
RUN npm install -g pm2

WORKDIR /app

# Copy package.json và cài đặt dependencies
COPY package*.json ./
RUN npm install --production  # Chỉ cài production dependencies

# Copy mã nguồn
COPY . .

# Tạo thư mục data
RUN mkdir -p /app/data && chmod 777 /app/data

EXPOSE 3000

CMD ["node", "server.js"]
