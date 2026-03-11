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

# Tạo thư mục data
WORKDIR /app

# Copy package.json và cài đặt
COPY package*.json ./
RUN npm install

# Copy mã nguồn
COPY . .

# Tạo thư mục data với quyền ghi
RUN mkdir -p /app/data && chmod 777 /app/data

# Expose port
EXPOSE 3000

# Chạy server
CMD ["node", "server.js"]
