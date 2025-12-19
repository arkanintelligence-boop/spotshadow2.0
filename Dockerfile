FROM node:18-alpine

# Install Python3, pip, and ffmpeg
# yt-dlp requires python
RUN apk add --no-cache python3 py3-pip ffmpeg

# Install yt-dlp
RUN pip3 install yt-dlp --break-system-packages

WORKDIR /app

# Copy package files from backend
COPY package*.json ./

# Install backend dependencies
RUN npm install --production

# Copy backend source code
COPY backend/ ./

# Copy frontend code to be served by the backend
COPY frontend/ ./public

# Environment variables defaults
ENV PORT=3000
ENV TEMP_DIR=/tmp/downloads
ENV DOCKER_ENV=true

# Create temp directory
RUN mkdir -p /tmp/downloads

EXPOSE 3000

CMD ["node", "server.js"]
