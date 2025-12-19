const path = require('path');
const fs = require('fs');
const os = require('os');
const pLimit = require('p-limit');
const ytDlp = require('yt-dlp-exec');
const NodeID3 = require('node-id3');
const axios = require('axios');
const archiver = require('archiver');
const youtubeService = require('./youtube');
const slugify = require('slugify');
const ffmpegPath = process.env.DOCKER_ENV ? 'ffmpeg' : require('ffmpeg-static');

// Concurrency limit
const limit = pLimit(Number(process.env.MAX_CONCURRENT_DOWNLOADS) || 5);

// Temp dir logic: use system temp or specific path
let TEMP_DIR = process.env.TEMP_DIR || path.join(os.tmpdir(), 'spotify-dl');
if (!path.isAbsolute(TEMP_DIR) && process.env.TEMP_DIR) {
    TEMP_DIR = path.join(__dirname, '..', process.env.TEMP_DIR);
}

// Ensure temp dir exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

async function downloadCover(url) {
    try {
        const response = await axios({
            url,
            responseType: 'arraybuffer',
            timeout: 5000
        });
        return response.data;
    } catch (e) {
        console.warn("Could not download cover image:", e.message);
        return null;
    }
}

async function processDownloadQueue(jobId, tracks, playlistName, io) {
    console.log(`Starting job ${jobId} for playlist ${playlistName}`);

    const jobDir = path.join(TEMP_DIR, jobId);
    if (!fs.existsSync(jobDir)) {
        fs.mkdirSync(jobDir, { recursive: true });
    }

    let completed = 0;
    const total = tracks.length;
    const errors = [];

    // Status emitters
    const emitStatus = (trackId, status) => {
        io.emit(`status:${jobId}`, {
            type: 'track_update',
            trackId,
            status
        });
    };

    const emitProgress = () => {
        io.emit(`status:${jobId}`, {
            type: 'progress',
            completed,
            total,
            percent: total === 0 ? 0 : Math.round((completed / total) * 100)
        });
    };

    // Helper: Retry logic is partly handled here by simply reporting error if fails. 
    // Usually yt-dlp has internal retries. We can add loop if needed.

    const tasks = tracks.map((track, index) => limit(async () => {
        const trackId = track.id;

        try {
            emitStatus(trackId, 'Searching...');

            // 1. Search YouTube
            const video = await youtubeService.findVideo(track.name, track.artist, track.duration);

            if (!video) {
                throw new Error('Video not found on YouTube');
            }

            const videoUrl = video.webpage_url || video.url; // webpage_url is standard

            // 2. Download
            emitStatus(trackId, 'Downloading...');

            // Normalize filename - CRITICAL FIX: Remove slashes to prevent folder creation
            // We use a stronger regex to strip ALL slashes and risky chars
            const cleanArtist = slugify(track.artist, { remove: /[*+~.()'"!:@/\\\\]/g, lower: false }).replace(/[:/]/g, '-');
            const cleanTrack = slugify(track.name, { remove: /[*+~.()'"!:@/\\\\]/g, lower: false }).replace(/[:/]/g, '-');
            const filenameObj = `${String(index + 1).padStart(2, '0')} - ${cleanArtist} - ${cleanTrack}.mp3`;
            const filePath = path.join(jobDir, filenameObj);

            // Docker structure differs from local structure due to 'COPY backend/ ./'
            const cookiesPath = process.env.DOCKER_ENV
                ? path.resolve(__dirname, '../cookies.txt')
                : path.resolve(__dirname, '../../cookies.txt');

            console.log(`[Downloader] Looking for cookies at: ${cookiesPath} (Exists: ${fs.existsSync(cookiesPath)})`);

            // yt-dlp args
            const ytOptions = {
                extractAudio: true,
                audioFormat: 'mp3',
                audioQuality: 0,
                output: filePath,
                noPlaylist: true,
                ffmpegLocation: ffmpegPath,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            };

            if (fs.existsSync(cookiesPath)) {
                ytOptions.cookies = cookiesPath;
            }

            // yt-dlp args
            await ytDlp(videoUrl, ytOptions);

            // 3. Metadata Tagging
            emitStatus(trackId, 'Tagging...');

            const tags = {
                title: track.name,
                artist: track.artist,
                album: track.album,
                year: track.year,
            };

            if (track.image) {
                const imageBuffer = await downloadCover(track.image);
                if (imageBuffer) {
                    tags.image = {
                        mime: "image/jpeg",
                        type: {
                            id: 3,
                            name: "front cover"
                        },
                        description: "Cover",
                        imageBuffer: imageBuffer
                    };
                }
            }

            const success = NodeID3.write(tags, filePath);
            if (!success) {
                // Try strictly passing filepath as string if write fails, typically standard.
                console.warn(`Failed to write ID3 tags for ${filePath}`);
            }

            emitStatus(trackId, 'Done');

        } catch (err) {
            console.error(`Error processing ${track.name}:`, err.message);
            errors.push({
                name: track.name,
                artist: track.artist,
                error: err.message
            });
            emitStatus(trackId, 'Error');
        } finally {
            completed++;
            emitProgress();
        }
    }));

    // Wait for all downloads
    await Promise.all(tasks);

    // 4. Create ZIP
    io.emit(`status:${jobId}`, { type: 'zipping' });

    const safePlaylistName = slugify(playlistName, { remove: /[*+~.()'"!:@]/g, lower: false });
    const zipName = `${safePlaylistName}.zip`;
    const zipPath = path.join(TEMP_DIR, `${jobId}.zip`);

    // Create info JSON
    fs.writeFileSync(path.join(jobDir, 'playlist_info.json'), JSON.stringify({
        name: playlistName,
        total_tracks: total,
        downloaded_tracks: total - errors.length,
        errors: errors,
        generated_at: new Date().toISOString()
    }, null, 2));

    try {
        await zipDirectory(jobDir, zipPath, safePlaylistName);

        // Cleanup job folder
        fs.rmSync(jobDir, { recursive: true, force: true });

        io.emit(`status:${jobId}`, { type: 'ready', url: `/api/file/${jobId}` });
    } catch (zipErr) {
        console.error("Zipping error:", zipErr);
        io.emit(`status:${jobId}`, { type: 'error', message: 'Failed to create zip file' });
    }
}

function zipDirectory(sourceDir, outPath, rootName) {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(outPath);

    return new Promise((resolve, reject) => {
        archive
            .directory(sourceDir, rootName || false) // put files inside a folder matching playlist name? Prompt suggests "Nome_da_Playlist/" structure.
            .on('error', err => reject(err))
            .pipe(stream);

        stream.on('close', () => resolve());
        archive.finalize();
    });
}

function getZipPath(jobId) {
    const p = path.join(TEMP_DIR, `${jobId}.zip`);
    return fs.existsSync(p) ? p : null;
}

module.exports = { processDownloadQueue, getZipPath };
