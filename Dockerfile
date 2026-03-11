# Xóa file Dockerfile cũ
rm Dockerfile

# Tạo file Dockerfile mới với nội dung đúng
cat > Dockerfile << 'EOF'
FROM node:18-bullseye

# Cài đặt các gói cần thiết
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    nano \
    vim \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Tạo symlink
RUN ln -s /usr/bin/python3 /usr/bin/python
RUN ln -s /usr/bin/pip3 /usr/bin/pip

# Cài đặt PM2
RUN npm install -g pm2

WORKDIR /app

# Copy package.json và cài đặt dependencies
COPY package*.json ./
RUN npm install

# Copy toàn bộ mã nguồn
COPY . .

# Tạo thư mục data
RUN mkdir -p /app/data && chmod 777 /app/data

EXPOSE 3000

CMD ["node", "server.js"]
EOF

# Kiểm tra nội dung
cat Dockerfile
