const express = require('express');
const router = express.Router();
const spotifyService = require('../services/spotify');
const downloaderService = require('../services/downloader');
const { v4: uuidv4 } = require('uuid');

// Store active jobs status (for validation, though socket handles real-time)
const jobs = new Map();

router.post('/analyze', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        console.log(`Analyzing playlist: ${url}`);
        const data = await spotifyService.getPlaylistData(url);
        res.json(data);
    } catch (error) {
        console.error("Analyze error:", error);
        res.status(500).json({ error: 'Failed to analyze playlist', details: error.message });
    }
});

const soulseekService = require('../services/soulseek-downloader');

router.post('/download', async (req, res) => {
    try {
        const { tracks, playlistName, playlistUrl } = req.body;

        if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
            return res.status(400).json({ error: 'Tracks list is empty or invalid' });
        }

        const jobId = uuidv4();
        jobs.set(jobId, {
            status: 'starting',
            playlistName: playlistName || 'Playlist',
            timestamp: Date.now()
        });

        // Start processing in background
        const io = req.app.get('socketio');

        // Check for Soulseek credentials (env or hardcoded fallback check)
        // Since we hardcoded them in the service, we can assume true if URL exists, but let's be explicit
        const hasCredentials = (process.env.SOULSEEK_USER && process.env.SOULSEEK_PASS) || true; // Hardcoded fallback active
        const useSoulseek = hasCredentials && playlistUrl;

        // Async call - do not await
        if (useSoulseek) {
            console.log(`Starting Soulseek download for job ${jobId}`);

            // Soulseek download
            soulseekService.downloadPlaylistSoulseek(playlistUrl, io, jobId)
                .then(async (results) => {
                    // Zip results
                    io.emit(`status:${jobId}`, { type: 'zipping' });

                    const safeName = playlistName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    const jobDir = require('path').join(process.env.DOWNLOAD_DIR || '/tmp/downloads', jobId);
                    const zipPath = require('path').join(process.env.DOWNLOAD_DIR || '/tmp/downloads', `${jobId}.zip`);

                    try {
                        await downloaderService.zipDirectory(jobDir, zipPath, safeName);
                        require('fs').rmSync(jobDir, { recursive: true, force: true });
                        io.emit(`status:${jobId}`, { type: 'ready', url: `/api/file/${jobId}` });
                    } catch (zipErr) {
                        console.error('Zip Error:', zipErr);
                        io.emit(`status:${jobId}`, { type: 'error', message: 'Failed to create ZIP' });
                    }
                })
                .catch(err => {
                    console.error(`Soulseek Job ${jobId} failed:`, err);
                    io.emit(`status:${jobId}`, { type: 'error', message: `Soulseek Error: ${err.message}` });
                });

        } else {
            // Fallback to YouTube
            downloaderService.processDownloadQueue(jobId, tracks, playlistName, io)
                .catch(err => console.error(`Job ${jobId} failed:`, err));
        }

        res.json({ jobId });
    } catch (error) {
        console.error("Download start error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/file/:jobId', (req, res) => {
    const { jobId } = req.params;
    const filePath = downloaderService.getZipPath(jobId);

    if (!filePath) {
        return res.status(404).json({ error: 'File not found. The download might not be finished yet or failed.' });
    }

    res.download(filePath, (err) => {
        if (err) {
            console.error(`Error sending file for job ${jobId}:`, err);
            if (!res.headersSent) {
                res.status(500).send("Error downloading file");
            }
        }
    });
});

module.exports = router;
