const ytDlp = require('yt-dlp-exec');

async function findVideo(track, artist, durationMs) {
    const query = `${track} ${artist} official audio`;
    const durationSec = Math.floor(durationMs / 1000);

    // Filter terms
    const blacklist = ['remix', 'cover', 'live', 'karaoke', 'instrumental'];
    const trackLower = track.toLowerCase();

    try {
        // Search for top 5 results
        // We use full dump to get duration and titles
        const output = await ytDlp(`ytsearch5:${query}`, {
            dumpSingleJson: true,
            noWarnings: true,
            flatPlaylist: false // We need details like duration
        });

        const entries = output.entries || [];
        if (entries.length === 0) return null;

        // 1. Precise Filter
        const bestMatch = entries.find(video => {
            const videoDuration = video.duration;
            const title = video.title.toLowerCase();

            // Duration check (approx 30s tolerance)
            if (Math.abs(videoDuration - durationSec) > 30) return false;

            // Blacklist check
            for (const term of blacklist) {
                // If title has a blacklisted term AND the original track name DOES NOT have it, skip
                if (title.includes(term) && !trackLower.includes(term)) return false;
            }

            return true;
        });

        if (bestMatch) return bestMatch;

        // 2. Relaxed Filter (Relax blacklist, keep duration)
        const durationMatch = entries.find(video => {
            return Math.abs(video.duration - durationSec) <= 40;
        });

        if (durationMatch) return durationMatch;

        // 3. Fallback to first result
        return entries[0];

    } catch (error) {
        console.error(`Search failed for ${track} - ${artist}:`, error.message);
        return null;
    }
}

module.exports = { findVideo };
