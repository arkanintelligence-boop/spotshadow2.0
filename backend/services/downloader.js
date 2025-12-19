const ytdlp = require('yt-dlp-exec');
const { searchYouTube } = require('./youtube-api');
const pLimit = require('p-limit');
// p-retry should be imported with dynamic import if it's ESM only, but v5 is usually compatible or we use dynamic import.
// Let's use standard require for now, if it fails we fix. It seems previous version used require.
const pRetry = require('p-retry');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const NodeID3 = require('node-id3');
const slugify = require('slugify');
const archiver = require('archiver');

// Import environment variables if not already loaded (usually loaded in server.js)
require('dotenv').config();

const CONFIG = {
    SEARCH_CONCURRENT: 25, // High concurrency for API
    DOWNLOAD_CONCURRENT: 10,
    MAX_RETRIES: 3,
    DOWNLOAD_DIR: process.env.DOWNLOAD_DIR || path.join(os.tmpdir(), 'spotify-dl'),
};

// Temp dir logic
if (!path.isAbsolute(CONFIG.DOWNLOAD_DIR) && process.env.DOWNLOAD_DIR) {
    // resolve relative path from root
    CONFIG.DOWNLOAD_DIR = path.resolve(__dirname, '..', '..', process.env.DOWNLOAD_DIR);
}

// Ensure download dir exists
if (!fs.existsSync(CONFIG.DOWNLOAD_DIR)) {
    fs.mkdirSync(CONFIG.DOWNLOAD_DIR, { recursive: true });
}

// Limiters
const searchLimiter = pLimit(CONFIG.SEARCH_CONCURRENT);
const downloadLimiter = pLimit(CONFIG.DOWNLOAD_CONCURRENT);

async function downloadCover(url) {
    try {
        const response = await axios({
            url,
            responseType: 'arraybuffer',
            timeout: 5000
        });
        return response.data;
    } catch (e) {
        return null;
    }
}

async function searchTrack(track, index, total, io, jobId) {
    return searchLimiter(async () => {
        try {
            io.emit(`status:${jobId}`, {
                type: 'track_update',
                trackId: track.id,
                status: 'Searching...'
            });

            const result = await pRetry(
                () => searchYouTube(track.name, track.artist),
                {
                    retries: CONFIG.MAX_RETRIES,
                    minTimeout: 1000,
                    onFailedAttempt: (error) => {
                        console.log(`Search retry ${error.attemptNumber} for: ${track.name}`);
                    },
                }
            );

            if (!result) {
                console.log(`❌ [${index + 1}/${total}] Not found: ${track.name}`);
                io.emit(`status:${jobId}`, {
                    type: 'track_update',
                    trackId: track.id,
                    status: 'Not Found'
                });
                return null;
            }

            // console.log(`✅ [${index + 1}/${total}] Found: ${result.title}`);

            return {
                track,
                videoId: result.videoId,
                videoUrl: result.url,
                title: result.title,
                index,
            };

        } catch (error) {
            console.error(`❌ [${index + 1}/${total}] Search failed: ${track.name} -`, error.message);
            io.emit(`status:${jobId}`, {
                type: 'track_update',
                trackId: track.id,
                status: 'Error'
            });
            return null;
        }
    });
}

function sanitizeFilename(filename) {
    return slugify(filename, { remove: /[*+~.()'"!:@/\\\\]/g, lower: false }).replace(/[:/]/g, '-').substring(0, 180);
}

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function downloadTrack(searchResult, io, jobId, jobDir) {
    return downloadLimiter(async () => {
        const { track, videoUrl, index } = searchResult;

        // Determine filename
        // We use original index from searchResult (which matches tracks array index)
        const originalIndex = index;
        const cleanName = sanitizeFilename(`${track.name} - ${track.artist}`);
        const filenameObj = `${String(originalIndex + 1).padStart(2, '0')} - ${cleanName}.mp3`;
        const outputPath = path.join(jobDir, filenameObj);

        try {
            io.emit(`status:${jobId}`, {
                type: 'track_update',
                trackId: track.id,
                status: 'Downloading...'
            });

            await pRetry(
                async () => {
                    // Use spawn for better control and aria2c
                    await new Promise((resolve, reject) => {
                        const args = [
                            videoUrl,
                            '-o', outputPath.replace('.mp3', '.%(ext)s'),
                            '--extract-audio',
                            '--audio-format', 'mp3',
                            '--audio-quality', '0',
                            '--no-warnings',
                            '--no-check-certificates',
                            '--socket-timeout', '30',
                            '--retries', '3',
                            '--fragment-retries', '3',

                            // Aria2c for speed
                            '--external-downloader', 'aria2c',
                            '--external-downloader-args', 'aria2c:-x 8 -s 8 -k 1M',

                            // User-Agent
                            '--user-agent', getRandomUserAgent(),

                            // Cookies: Do NOT use cookies for public video downloads to avoid rate limits
                            // unless necessary. For now, disable.

                            // Metadata
                            '--add-metadata',
                            '--embed-thumbnail',
                        ];

                        const ytdlpProcess = spawn('yt-dlp', args);

                        // let stderr = '';
                        // ytdlpProcess.stderr.on('data', (data) => { stderr += data.toString(); });

                        ytdlpProcess.on('close', (code) => {
                            if (code === 0) resolve();
                            else reject(new Error(`yt-dlp exited with code ${code}`));
                        });

                        ytdlpProcess.on('error', reject);
                    });

                    if (!fs.existsSync(outputPath)) {
                        throw new Error('File not found after download');
                    }

                    const stats = fs.statSync(outputPath);
                    if (stats.size < 50000) { // < 50KB
                        fs.unlinkSync(outputPath); // delete bad file
                        throw new Error('Downloaded file too small');
                    }
                },
                {
                    retries: CONFIG.MAX_RETRIES,
                    minTimeout: 2000,
                    onFailedAttempt: (error) => {
                        console.log(`Download retry ${error.attemptNumber} for: ${track.name}`);
                    },
                }
            );

            // Tagging
            io.emit(`status:${jobId}`, {
                type: 'track_update',
                trackId: track.id,
                status: 'Tagging...'
            });

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
                        type: { id: 3, name: "front cover" },
                        description: "Cover",
                        imageBuffer: imageBuffer
                    };
                }
            }
            NodeID3.write(tags, outputPath);

            io.emit(`status:${jobId}`, {
                type: 'track_update',
                trackId: track.id,
                status: 'Done'
            });

            return { track, filePath: outputPath, success: true };

        } catch (error) {
            console.error(`❌ Download failed: ${track.name} -`, error.message);

            io.emit(`status:${jobId}`, {
                type: 'track_update',
                trackId: track.id,
                status: 'Error'
            });

            return { track, error: error.message, success: false };
        }
    });
}

function zipDirectory(sourceDir, outPath, rootName) {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(outPath);

    return new Promise((resolve, reject) => {
        const prefix = rootName ? rootName + '/' : '';

        fs.readdir(sourceDir, (err, files) => {
            if (err) return reject(err);

            let count = 0;
            for (const file of files) {
                const filePath = path.join(sourceDir, file);
                const stats = fs.statSync(filePath);
                if (stats.size > 0 && (file.endsWith('.mp3') || file.endsWith('.json'))) {
                    archive.file(filePath, { name: prefix + file });
                    count++;
                }
            }
            // If empty, we should probably still finalize or reject? 
            // Let's finalize even if empty to avoid hanging, but warn.
            if (count === 0) console.warn("Warning: Zipping 0 files.");
            archive.finalize();
        });

        archive.on('error', err => reject(err)).pipe(stream);
        stream.on('close', () => resolve());
    });
}

async function processDownloadQueue(jobId, tracks, playlistName, io) {
    const total = tracks.length;

    console.log(`\n=== JOB ${jobId}: ${playlistName} (${total} tracks) ===\n`);

    const jobDir = path.join(CONFIG.DOWNLOAD_DIR, jobId);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

    // Phase 1: Search
    console.log('Phase 1: Searching tracks on YouTube API...');

    let completed = 0;
    // Progress emitter helper
    const emitProgress = () => {
        io.emit(`status:${jobId}`, {
            type: 'progress',
            completed,
            total,
            percent: total === 0 ? 0 : Math.round((completed / total) * 100)
        });
    };

    const searchPromises = tracks.map((track, index) =>
        searchTrack(track, index, total, io, jobId)
    );

    const searchResults = (await Promise.allSettled(searchPromises))
        .map(r => r.status === 'fulfilled' ? r.value : null)
        .filter(Boolean);

    console.log(`\n✅ Phase 1 Complete: ${searchResults.length}/${total} tracks found\n`);

    if (searchResults.length === 0) {
        io.emit(`status:${jobId}`, { type: 'error', message: 'No tracks found on YouTube' });
        return;
    }

    // Phase 2: Download
    console.log('Phase 2: Downloading audio files...');

    // Update progress to reflect that searches are done, now downloading.
    // Actually, let's keep progress simple: each step counts? 
    // Standard logic: search is fast, download is slow. Let's base progress on download completion mostly?
    // Or stick to 1 track = 1 unit of work (Search + Download).
    // Current logic in `downloadTrack` emits updates. 
    // We need to handle `completed` increment in download phase.

    // Mark failed searches as 'completed' for progress bar
    completed = tracks.length - searchResults.length;
    emitProgress();

    const downloadPromises = searchResults.map(result =>
        downloadTrack(result, io, jobId, jobDir).then(res => {
            completed++;
            emitProgress();
            return res;
        })
    );

    const downloadResults = await Promise.allSettled(downloadPromises);

    // Check results
    const successful = downloadResults.filter(r => r.status === 'fulfilled' && r.value?.success);
    console.log(`\n=== DOWNLOAD COMPLETE: ${successful.length}/${total} successful ===`);

    // Zip
    io.emit(`status:${jobId}`, { type: 'zipping' });

    const safeName = slugify(playlistName, { remove: /[*+~.()'"!:@]/g, lower: false });
    const zipPath = path.join(CONFIG.DOWNLOAD_DIR, `${jobId}.zip`);

    // Info JSON
    fs.writeFileSync(path.join(jobDir, 'info.json'), JSON.stringify({
        playlist: playlistName,
        total,
        successful: successful.length,
        date: new Date()
    }, null, 2));

    try {
        await zipDirectory(jobDir, zipPath, safeName);
        fs.rmSync(jobDir, { recursive: true, force: true }); // Cleanup temp folder

        io.emit(`status:${jobId}`, { type: 'ready', url: `/api/file/${jobId}` });
    } catch (err) {
        console.error("Zipping error:", err);
        io.emit(`status:${jobId}`, { type: 'error', message: 'Failed to create ZIP' });
    }
}

function getZipPath(jobId) {
    const p = path.join(CONFIG.DOWNLOAD_DIR, `${jobId}.zip`);
    return fs.existsSync(p) ? p : null;
}

module.exports = { processDownloadQueue, getZipPath };
