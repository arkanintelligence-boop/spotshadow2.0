const SpotifyWebApi = require('spotify-web-api-node');

const spotifyApi = new SpotifyWebApi({
    clientId: '09c18d6afd974b37baf1b198c13f06a1',
    clientSecret: '4ea62702d3d14c8295048ccc5b12f181'
});

let tokenExpiration = 0;

async function ensureToken() {
    // If token is valid for more than 1 minute, reuse it
    if (Date.now() < tokenExpiration) return;

    try {
        console.log("Refreshing Spotify Access Token...");
        console.log("Using Client ID:", process.env.SPOTIFY_CLIENT_ID ? process.env.SPOTIFY_CLIENT_ID.substring(0, 5) + '...' : 'UNDEFINED');
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
        // Set expiration time (expires_in is in seconds)
        tokenExpiration = Date.now() + (data.body['expires_in'] * 1000) - 60000;
        console.log("Spotify Token Refreshed");
    } catch (err) {
        console.error('Error retrieving Spotify access token:', JSON.stringify(err));
        console.error(err); // print full object
        throw new Error(`Failed to connect to Spotify API. Details: ${err.message || JSON.stringify(err)}`);
    }
}

async function getPlaylistData(url) {
    await ensureToken();

    // Extract ID from URL
    // Supports: https://open.spotify.com/playlist/ID?si=...
    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    if (!match) throw new Error('Invalid Spotify Playlist URL. Please check the link.');
    const playlistId = match[1];

    try {
        const data = await spotifyApi.getPlaylist(playlistId);
        const playlistName = data.body.name;
        const tracks = [];

        let items = data.body.tracks.items;
        let next = data.body.tracks.next;
        let total = data.body.tracks.total;

        const processItems = (batch) => {
            batch.forEach(item => {
                if (item.track) {
                    tracks.push({
                        name: item.track.name,
                        artist: item.track.artists.map(a => a.name).join(', '),
                        album: item.track.album.name,
                        year: item.track.album.release_date ? item.track.album.release_date.split('-')[0] : '',
                        image: item.track.album.images[0]?.url, // Highest resolution
                        duration: item.track.duration_ms,
                        id: item.track.id
                    });
                }
            });
        };

        processItems(items);

        // Fetch remaining tracks if any
        while (next && tracks.length < total) {
            console.log(`Fetching more tracks... (${tracks.length}/${total})`);
            const more = await spotifyApi.getPlaylistTracks(playlistId, { offset: tracks.length });
            processItems(more.body.items);
            next = more.body.next;
        }

        return {
            name: playlistName,
            total: tracks.length,
            tracks
        };
    } catch (err) {
        console.error("Spotify API Error Full:", JSON.stringify(err));
        if (err.body && err.body.error) {
            console.error("Spotify Error Body:", err.body.error);
            throw new Error(`Spotify API: ${err.body.error.message || err.body.error}`);
        }
        throw new Error('Could not fetch playlist. Ensure it is public and the URL is correct.');
    }
}

module.exports = { getPlaylistData };
