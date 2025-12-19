const path = require('path');
const fs = require('fs');
const os = require('os');
const pLimit = require('p-limit');
const ytDlp = require('yt-dlp-exec');
const NodeID3 = require('node-id3');
const axios = require('axios');
const archiver = require('archiver');
const { searchInvidious } = require('./invidious');
const slugify = require('slugify');
const ffmpegPath = process.env.DOCKER_ENV ? '/usr/bin/ffmpeg' : require('ffmpeg-static');

// Configuration
const CONFIG = {
    SEARCH_CONCURRENT: 20,
    DOWNLOAD_CONCURRENT: 10,
    MAX_RETRIES: 3,
};

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

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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

    // Limiters
    const searchLimiter = pLimit(CONFIG.SEARCH_CONCURRENT);
    const downloadLimiter = pLimit(CONFIG.DOWNLOAD_CONCURRENT);

    // ==========================================================================================
    // PHASE 1: SEARCH (Invidious API - No Rate Limit)
    // ==========================================================================================

    console.log(`Phase 1: Searching ${tracks.length} tracks via Invidious...`);

    const searchPromises = tracks.map((track, index) => searchLimiter(async () => {
        const trackId = track.id;
        try {
            emitStatus(trackId, 'Searching...');

            // Random small delay just to be safe
            await new Promise(r => setTimeout(r, Math.random() * 500));

            const result = await searchInvidious(track.name, track.artist);

            if (!result) {
                throw new Error('Video not found on YouTube (Invidious)');
            }

            return {
                track,
                videoUrl: result.url,
                videoId: result.videoId,
                title: result.title,
                originalIndex: index,
                success: true
            };

        } catch (err) {
            console.error(`Search failed for ${track.name}:`, err.message);
            errors.push({
                name: track.name,
                artist: track.artist,
                error: err.message
            });
            emitStatus(trackId, 'Error (Not Found)');
            return { track, success: false, error: err };
        }
    }));

    const searchResultsRaw = await Promise.all(searchPromises);

    // ==========================================================================================
    // PHASE 2: DOWNLOAD (Direct URL via yt-dlp + Aria2c)
    // ==========================================================================================

    console.log(`Phase 2: Downloading found tracks...`);

    // Filter only successful searches
    const validItems = searchResultsRaw.filter(r => r.success);
    const searchFailures = searchResultsRaw.filter(r => !r.success).length;
    completed += searchFailures; // Mark failed searches as 'processed'
    emitProgress();

    const downloadTasks = validItems.map((item) => downloadLimiter(async () => {
        const { track, videoUrl, originalIndex } = item;
        const trackId = track.id;

        try {
            emitStatus(trackId, 'Downloading...');

            // Normalize filename
            const cleanArtist = slugify(track.artist, { remove: /[*+~.()'"!:@/\\\\]/g, lower: false }).replace(/[:/]/g, '-');
            const cleanTrack = slugify(track.name, { remove: /[*+~.()'"!:@/\\\\]/g, lower: false }).replace(/[:/]/g, '-');
            const filenameObj = `${String(originalIndex + 1).padStart(2, '0')} - ${cleanArtist} - ${cleanTrack}.mp3`;
            const filePath = path.join(jobDir, filenameObj);

            const ytOptions = {
                output: filePath,
                extractAudio: true,
                audioFormat: 'mp3',
                audioQuality: '0',
                noPlaylist: true,
                ffmpegLocation: ffmpegPath,

                // Configurações anti-rate-limit
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                socketTimeout: 60,
                retries: 3,
                fragmentRetries: 3,

                // IMPORTANTE: Usar aria2c se disponível
                externalDownloader: 'aria2c',
                externalDownloaderArgs: [
                    '-x', '8',
                    '-s', '8',
                    '-k', '1M',
                ],

                // User-Agent aleatório
                userAgent: getRandomUserAgent(),

                // CRÍTICO: NÃO usar cookies aqui também
                // (yt-dlp baixa direto a URL, não precisa de cookies se for video publico)
            };

            // yt-dlp execution
            try {
                await ytDlp(videoUrl, ytOptions);
            } catch (dlErr) {
                throw dlErr;
            }

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
    await Promise.all(downloadTasks);

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
        // Filter: Only zip MP3 and JSON files
        const prefix = rootName ? rootName + '/' : '';

        // Manual file addition to check sizes
        fs.readdir(sourceDir, (err, files) => {
            if (err) return reject(err);

            for (const file of files) {
                const filePath = path.join(sourceDir, file);
                const stats = fs.statSync(filePath);

                // Only add files > 0 bytes and matching extension
                if (stats.size > 0 && (file.endsWith('.mp3') || file.endsWith('.json'))) {
                    archive.file(filePath, { name: prefix + file });
                } else {
                    console.warn(`Skipping empty or invalid file: ${file}`);
                }
            }
            archive.finalize();
        });

        archive
            .on('error', err => reject(err))
            .pipe(stream);

        stream.on('close', () => resolve());
    });
}

function getZipPath(jobId) {
    const p = path.join(TEMP_DIR, `${jobId}.zip`);
    return fs.existsSync(p) ? p : null;
}

module.exports = { processDownloadQueue, getZipPath };
