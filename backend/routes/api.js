const express = require('express');
const router = express.Router();
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { getSpotifyPlaylist } = require('../services/spotify'); // Assuming this exists or will be replaced
// Actually, I need to check if spotify service exports getSpotifyPlaylist or getPlaylistData.
// Previous code used getPlaylistData. I'll stick to what I know works or check.
// Checking previous view: getPlaylistData.
// But user prompt used getSpotifyPlaylist.
// I will check spotify service after this write if needed, or use safe approach.
// Let's use getPlaylistData which I saw in step 434.

const spotifyService = require('../services/spotify');
const { downloadPlaylistSpotdl } = require('../services/spotdl-downloader');

// Helper for Zip
async function createZip(files, playlistName, jobId) {
    const zipPath = path.join('/tmp/downloads', `${jobId}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    return new Promise((resolve, reject) => {
        output.on('close', () => resolve(zipPath));
        output.on('error', reject);
        archive.on('error', reject);

        archive.pipe(output);

        const sanitizedName = playlistName.replace(/[^a-z0-9]/gi, '_');

        files.forEach((file, index) => {
            if (fs.existsSync(file.filePath)) {
                const fileName = path.basename(file.filePath);
                archive.file(file.filePath, {
                    name: `${sanitizedName}/${String(index + 1).padStart(3, '0')} - ${fileName}`
                });
            }
        });

        archive.finalize();
    });
}

// POST /api/analyze (Keep existing if compatible, or use spotDL to analyze?)
// Existing analyze uses spotifyService.getPlaylistData. Let's keep it.
router.post('/analyze', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        console.log(`Analyzing playlist: ${url}`);
        // Use existing service
        const data = await spotifyService.getPlaylistData(url);
        res.json(data);
    } catch (error) {
        console.error("Analyze error:", error);
        res.status(500).json({ error: 'Failed to analyze playlist', details: error.message });
    }
});

// POST /api/download
router.post('/download', async (req, res) => {
    try {
        const { playlistUrl, tracks, playlistName } = req.body;

        if (!playlistUrl) {
            return res.status(400).json({ error: 'Playlist URL required for spotDL' });
        }

        const jobId = Date.now().toString(36) + Math.random().toString(36).substr(2);

        // Setup Socket
        const io = req.app.get('socketio') || req.app.get('io');

        // Notify Start
        if (io) {
            io.emit(`status:${jobId}`, {
                type: 'status',
                message: 'Starting spotDL...'
            });
        }

        // Start Async Download
        downloadPlaylistSpotdl(playlistUrl, jobId, (progress) => {
            if (!io) return;

            // Adapt spotDL progress to frontend expectation
            if (progress.type === 'progress') {
                io.emit(`status:${jobId}`, {
                    type: 'progress',
                    completed: progress.current,
                    total: progress.total,
                    percent: progress.percent,
                    status: 'Downloading...'
                });
            } else if (progress.type === 'track_update') {
                io.emit(`status:${jobId}`, {
                    type: 'track_update',
                    trackId: 'unknown',
                    status: `Processing: ${progress.track}`
                });
            } else if (progress.type === 'status') {
                io.emit(`status:${jobId}`, { type: 'status', message: progress.message });
            }
        }).then(async (results) => {
            // Success - Create Zip
            if (io) io.emit(`status:${jobId}`, { type: 'zipping' });

            try {
                await createZip(results.successful, playlistName || 'playlist', jobId);

                // Clean up raw files immediately
                const jobDir = path.join('/tmp/downloads', jobId);
                if (fs.existsSync(jobDir)) {
                    fs.rmSync(jobDir, { recursive: true, force: true });
                }

                if (io) {
                    io.emit(`status:${jobId}`, {
                        type: 'ready',
                        url: `/api/file/${jobId}`
                    });
                }

            } catch (zipErr) {
                console.error('Zip Error:', zipErr);
                if (io) io.emit(`status:${jobId}`, { type: 'error', message: 'Zip Failed' });
            }

        }).catch(err => {
            console.error('Download Error:', err);
            if (io) io.emit(`status:${jobId}`, { type: 'error', message: err.message });
        });

        // Return Job ID immediately
        res.json({ jobId });

    } catch (error) {
        console.error('Download route error:', error);
        res.status(500).json({
            error: error.message || 'Download failed'
        });
    }
});

// GET /api/file/:jobId
router.get('/file/:jobId', (req, res) => {
    const { jobId } = req.params;
    const filePath = path.join('/tmp/downloads', `${jobId}.zip`);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found.' });
    }

    res.download(filePath, (err) => {
        if (err) {
            console.error(`Error sending file ${jobId}:`, err);
        }
    });
});

module.exports = router;
