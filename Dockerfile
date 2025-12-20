FROM python:3.11-slim

# Install system dependencies and Node.js
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install spotDL
RUN pip install --no-cache-dir spotdl

# Verify spotdl installation
RUN spotdl --version

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./
RUN npm ci --only=production

# Copy backend source
COPY backend/ ./

# Copy frontend to public
COPY frontend/ ./public

# Create temp directory
RUN mkdir -p /tmp/downloads && chmod 777 /tmp/downloads

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
