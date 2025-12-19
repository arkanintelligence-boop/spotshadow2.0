# SpotShadow - Spotify Playlist Downloader

A modern web application to download Spotify playlists by finding and downloading the corresponding tracks from YouTube in high quality.

## Features

- 🎵 **Spotify Integration**: Extracts track lists, artwork, and metadata from any public Spotify playlist.
- 📺 **Intelligent Matching**: Searches YouTube for the best audio match using duration and smart filtering (avoids live versions/remixes).
- ⬇️ **Parallel Downloads**: Uses a queue system to download multiple tracks simultaneously.
- 🏷️ **ID3 Tagging**: Automatically tags MP3 files with Title, Artist, Album, Year, and Cover Art.
- 📦 **ZIP Export**: Bundles the downloaded playlist into a clean ZIP file.
- 🎨 **Modern UI**: Dark mode, glassmorphism design, and real-time progress updates.
- 🐳 **Docker Ready**: Fully containerized for easy deployment (e.g., Easypanel).

## Prerequisites

- **Node.js** v18+ (if running locally)
- **Python 3.10+** (required for yt-dlp)
- **FFmpeg** (needs to be in your system PATH)
- **Spotify Developer Credentials** (Client ID and Secret)

## Setup & Running

### 1. Environment Variables

Create a `.env` file in the root directory (based on `.env.example`):

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
PORT=3000
MAX_CONCURRENT_DOWNLOADS=5
```

### 2. Running with Docker (Recommended)

```bash
docker-compose up --build
```
Access the app at `http://localhost:3000`.

### 3. Running Locally

1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```

2. Start the server:
   ```bash
   # Make sure you are in the backend directory
   node server.js
   ```

3. Open `http://localhost:3000` in your browser.

## Architecture

- **Backend**: Node.js + Express
- **Frontend**: Vanilla JS + CSS (Single Page App)
- **Services**:
  - `spotify-web-api-node`: Playlist extraction.
  - `yt-dlp-exec`: YouTube interaction (via yt-dlp Python tool).
  - `fluent-ffmpeg`: Audio conversion.
  - `node-id3`: Metadata tagging.
  - `socket.io`: Real-time status updates.

## Disclaimer

This tool is for educational purposes only. Please respect copyright laws and the terms of service of the platforms involved.
