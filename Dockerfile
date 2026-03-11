# Xóa file cũ
rm Dockerfile

# Tạo file mới với nội dung đúng
cat > Dockerfile << 'EOF'
FROM node:18-bullseye

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    nano \
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
