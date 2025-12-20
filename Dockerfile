FROM node:18-alpine

# Install Python3, pip, and ffmpeg
# yt-dlp requires python
RUN apk add --no-cache python3 py3-pip ffmpeg aria2

# Install yt-dlp
RUN pip3 install yt-dlp --break-system-packages

# Install sldl (Soulseek Downloader)
RUN wget -L https://github.com/fiso64/slsk-batchdl/releases/latest/download/sldl_linux-x64.zip && \
    unzip sldl_linux-x64.zip -d /tmp/sldl_extracted && \
    mv /tmp/sldl_extracted/sldl /usr/local/bin/ || mv /tmp/sldl_extracted/*/sldl /usr/local/bin/ && \
    chmod +x /usr/local/bin/sldl && \
    rm -rf sldl_linux-x64.zip /tmp/sldl_extracted

WORKDIR /app

# Copy package files from backend
COPY package*.json ./
COPY cookies.txt ./

# Install backend dependencies
RUN npm install --production

# Copy backend source code
COPY backend/ ./

# Copy frontend code to be served by the backend
COPY frontend/ ./public

# Environment variables defaults
ENV PORT=80
ENV TEMP_DIR=/tmp/downloads
ENV DOCKER_ENV=true

# Create temp directory
RUN mkdir -p /tmp/downloads

EXPOSE 80

CMD ["node", "server.js"]
