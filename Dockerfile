# Xóa file Dockerfile cũ (nếu có)
rm Dockerfile

# Tạo file Dockerfile mới với nội dung chuẩn
cat > Dockerfile << 'EOF'
FROM node:18-bullseye

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
RUN ln -s /usr/bin/pip3 /usr/bin/pip
RUN npm install -g pm2

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/data && chmod 777 /app/data

EXPOSE 3000

CMD ["node", "server.js"]
EOF
