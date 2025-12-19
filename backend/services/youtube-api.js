```javascript
const axios = require('axios');

// Retrieve keys from environment variables
const YOUTUBE_API_KEYS = [
    process.env.YOUTUBE_API_KEY_1,
    process.env.YOUTUBE_API_KEY_2,
    process.env.YOUTUBE_API_KEY_3,
    process.env.YOUTUBE_API_KEY_4,
    process.env.YOUTUBE_API_KEY_5,
].filter(Boolean); // Filter out undefined/empty keys

if (YOUTUBE_API_KEYS.length === 0) {
    console.warn("WARNING: No YOUTUBE_API_KEYS found in .env. Fallback or errors may occur.");
}

let keyIndex = 0;
let requestCounts = YOUTUBE_API_KEYS.map(() => 0);

function getNextApiKey() {
    if (YOUTUBE_API_KEYS.length === 0) {
        throw new Error("No YouTube API keys configured.");
    }
    // Rotate keys to distribute quota
    const key = YOUTUBE_API_KEYS[keyIndex];
    requestCounts[keyIndex]++;
    keyIndex = (keyIndex + 1) % YOUTUBE_API_KEYS.length;

    // console.log(`Using API key ${ keyIndex + 1 }, requests: ${ requestCounts[keyIndex] } `);

    return key;
}

async function searchYouTube(trackName, artist) {
    try {
        const apiKey = getNextApiKey();
        const query = encodeURIComponent(`${ trackName } ${ artist } official audio`);

        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=5&key=${apiKey}`;

const response = await axios.get(url, {
    headers: {
        'Accept': 'application/json',
    },
    timeout: 10000,
});

const data = response.data;

if (!data.items || data.items.length === 0) {
    return null; // Not found
}

// Get video details (duration) for better matching
const videoIds = data.items.map(item => item.id.videoId).join(',');
const videoDetails = await getVideoDetails(videoIds);

// Find best match
const bestMatch = findBestMatch(data.items, videoDetails, trackName, artist);

if (!bestMatch) return null;

return {
    videoId: bestMatch.id.videoId,
    url: `https://www.youtube.com/watch?v=${bestMatch.id.videoId}`,
    title: bestMatch.snippet.title,
    channelTitle: bestMatch.snippet.channelTitle,
    duration: bestMatch.duration,
};

    } catch (error) {
    if (error.response && error.response.status === 403) {
        const data = error.response.data;
        // Check for quota error specifically
        if (data.error && data.error.message && (data.error.message.includes('quota') || data.error.message.includes('Limit Exceeded'))) {
            console.error(`⚠️ API key quota exceeded! Rotating...`);
            // Try next key recursively (be careful of infinite loop if all quotas full)
            // Ideally we should track failed keys to stop recursion
            // simple safety: if we rotated through all keys, fail.
            // For now, let's just throw so retry logic handles it or next call uses next key.
            throw new Error("Quota Exceeded");
        }
    }
    console.error(`YouTube API search error for ${trackName}:`, error.message);
    // If quota exceeded, we might want to propagate that specific error
    throw error;
}
}

async function getVideoDetails(videoIds) {
    try {
        const apiKey = getNextApiKey();
        const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${apiKey}`;

        const response = await axios.get(url, { timeout: 10000 });
        const data = response.data;

        const details = {};
        data.items?.forEach(item => {
            details[item.id] = {
                duration: parseDuration(item.contentDetails.duration),
            };
        });

        return details;
    } catch (error) {
        console.error('Error fetching video details:', error.message);
        return {};
    }
}

function parseDuration(isoDuration) {
    // Convert PT4M33S to seconds
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);

    return hours * 3600 + minutes * 60 + seconds;
}

function findBestMatch(items, videoDetails, trackName, artist) {
    const scored = items.map(item => {
        let score = 0;
        const title = item.snippet.title.toLowerCase();
        const channel = item.snippet.channelTitle.toLowerCase();
        const trackLower = trackName.toLowerCase();
        const artistLower = artist.toLowerCase();

        // Track name in title (+50)
        if (title.includes(trackLower)) score += 50;

        // Artist in title or channel (+40)
        if (title.includes(artistLower) || channel.includes(artistLower)) {
            score += 40;
        }

        // Official channel/topic (+30)
        if (channel.includes('official') || channel.includes(' - topic')) {
            score += 30;
        }

        // "official" in title (+20)
        if (title.includes('official')) score += 20;

        // Penalize remixes, covers, live unless requested (-50)
        if (/(remix|cover|live|karaoke|instrumental|piano|acoustic)/i.test(title) && !trackLower.includes('remix') && !trackLower.includes('live')) {
            score -= 50;
        }

        // Check duration (standard song: 2-8 mins)
        const duration = videoDetails[item.id.videoId]?.duration || 0;
        if (duration >= 120 && duration <= 480) {
            score += 20;
        } else if (duration > 600) { // > 10 mins
            score -= 20;
        }

        return { ...item, score, duration };
    });

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Return best match if score is reasonable (e.g. > 0)
    return scored[0]?.score > 0 ? scored[0] : null;
}

module.exports = { searchYouTube };
```
