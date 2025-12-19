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
const ffmpegPath = process.env.DOCKER_ENV ? '/usr/bin/ffmpeg' : require('ffmpeg-static');

// Concurrency limit - Restored to safe level to fix YouTube Rate Limits
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

    // Concurrency Limits
    const searchLimit = pLimit(15);
    const downloadLimit = pLimit(12);

    // ==========================================================================================
    // PHASE 1: SEARCH (No Cookies, High Concurrency)
    // ==========================================================================================

    console.log(`Phase 1: Searching ${tracks.length} tracks...`);
    const searchResults = await Promise.all(tracks.map((track) => searchLimit(async () => {
        const trackId = track.id;
        try {
            emitStatus(trackId, 'Searching...');

            // Random delay to prevent burst
            const delay = Math.floor(Math.random() * 2000) + 500;
            await new Promise(r => setTimeout(r, delay));

            const video = await youtubeService.findVideo(track.name, track.artist, track.duration);

            if (!video) {
                throw new Error('Video not found on YouTube');
            }

            return {
                track,
                videoUrl: video.webpage_url || video.url,
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
    })));

    // ==========================================================================================
    // PHASE 2: DOWNLOAD (Cookies, Moderate Concurrency, Aria2c)
    // ==========================================================================================

    console.log(`Phase 2: Downloading found tracks...`);

    // Filter only successful searches
    const validItems = searchResults.filter(r => r.success);
    const searchFailures = searchResults.filter(r => !r.success).length;
    completed += searchFailures; // Mark failed searches as 'completed' (processed)
    emitProgress();

    const downloadTasks = validItems.map((item) => downloadLimit(async () => {
        const { track, videoUrl } = item;
        // Find original index to keep filenames ordered in ZIP
        const originalIndex = tracks.findIndex(t => t.id === track.id);
        const trackId = track.id;

        try {
            emitStatus(trackId, 'Downloading...');

            // Normalize filename - remove slash to prevent folder creation
            const cleanArtist = slugify(track.artist, { remove: /[*+~.()'"!:@/\\\\]/g, lower: false }).replace(/[:/]/g, '-');
            const cleanTrack = slugify(track.name, { remove: /[*+~.()'"!:@/\\\\]/g, lower: false }).replace(/[:/]/g, '-');
            const filenameObj = `${String(originalIndex + 1).padStart(2, '0')} - ${cleanArtist} - ${cleanTrack}.mp3`;
            const filePath = path.join(jobDir, filenameObj);

            // Docker vs Local path logic
            const cookiesPath = process.env.DOCKER_ENV
                ? path.resolve(__dirname, '../cookies.txt')
                : path.resolve(__dirname, '../../cookies.txt');

            const ytOptions = {
                extractAudio: true,
                audioFormat: 'mp3',
                audioQuality: 0,
                output: filePath,
                noPlaylist: true,
                ffmpegLocation: ffmpegPath,
                extractorArgs: "youtube:player_client=ios",
                // PERFORMANCE OPTIMIZATIONS
                format: 'bestaudio/best',
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                youtubeSkipDashManifest: true,

                // ARIA2C CONFIGURATION
                externalDownloader: 'aria2c',
                externalDownloaderArgs: ['-x', '16', '-s', '16', '-k', '1M'],

                // Network tuning
                socketTimeout: 30,
                retries: 3,
                fragmentRetries: 3
            };

            if (fs.existsSync(cookiesPath)) {
                ytOptions.cookies = cookiesPath;
            }

            // yt-dlp execution with retry logic (Cookie fallback)
            try {
                await ytDlp(videoUrl, ytOptions);
            } catch (dlErr) {
                console.warn(`Download failed with cookies for ${track.name}, retrying without cookies...`);
                if (ytOptions.cookies) {
                    delete ytOptions.cookies;
                    await ytDlp(videoUrl, ytOptions);
                } else {
                    throw dlErr;
                }
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
        // Filter: Only zip MP3 and JSON files to exclude .part/.ytdl temp files
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
