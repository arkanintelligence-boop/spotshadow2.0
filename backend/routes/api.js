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

router.post('/download', async (req, res) => {
    try {
        const { tracks, playlistName } = req.body;

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

        // Async call - do not await
        downloaderService.processDownloadQueue(jobId, tracks, playlistName, io)
            .catch(err => console.error(`Job ${jobId} failed:`, err));

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
