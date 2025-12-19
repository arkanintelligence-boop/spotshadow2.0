const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.private.coffee',
    'https://yt.artemislena.eu',
    'https://invidious.protokolla.fi',
    'https://invidious.nerdvpn.de',
    'https://inv.riverside.rocks',
    'https://invidious.lunar.icu',
    'https://vid.puffyan.us',
    'https://invidious.flokinet.to',
    'https://yt.oelrichsgarcia.de',
];

let instanceIndex = 0;

function getNextInstance() {
    const instance = INVIDIOUS_INSTANCES[instanceIndex];
    instanceIndex = (instanceIndex + 1) % INVIDIOUS_INSTANCES.length;
    return instance;
}

async function searchInvidious(trackName, artist, retries = 3) {
    // Use dynamic import for node-fetch since it's an ESM module
    const { default: fetch } = await import('node-fetch');

    const query = encodeURIComponent(`${trackName} ${artist}`);

    for (let i = 0; i < retries; i++) {
        const instance = getNextInstance();

        try {
            const response = await fetch(
                `${instance}/api/v1/search?q=${query}&type=video&sort_by=relevance`,
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    },
                    timeout: 10000, // 10s timeout
                }
            );

            if (!response.ok) {
                console.log(`Instance ${instance} failed, trying next...`);
                continue;
            }

            const data = await response.json();

            if (!data || data.length === 0) {
                return null; // Nenhum resultado encontrado
            }

            // Retornar o melhor match
            const bestMatch = findBestMatch(data, trackName, artist);
            if (!bestMatch) continue; // Try another instance if no good match

            return {
                videoId: bestMatch.videoId,
                url: `https://www.youtube.com/watch?v=${bestMatch.videoId}`,
                title: bestMatch.title,
                duration: bestMatch.lengthSeconds,
                author: bestMatch.author,
            };

        } catch (error) {
            console.error(`Invidious instance ${instance} error:`, error.message);

            if (i === retries - 1) {
                // Just return null instead of throwing to allow partial results failure
                // throw new Error(`All Invidious instances failed for: ${trackName}`); 
                return null;
            }

            // Aguardar 1s antes de tentar próxima instância
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

function findBestMatch(results, trackName, artist) {
    // Filtrar resultados por duração (evitar vídeos muito curtos/longos)
    const validResults = results.filter(r =>
        r.lengthSeconds > 60 && r.lengthSeconds < 900 // Entre 1min e 15min
    );

    if (validResults.length === 0) return results[0];

    // Calcular score para cada resultado
    const scored = validResults.map(result => {
        let score = 0;
        const titleLower = result.title.toLowerCase();
        const trackLower = trackName.toLowerCase();
        const artistLower = artist.toLowerCase();

        // Nome da música no título (+50 pontos)
        if (titleLower.includes(trackLower)) score += 50;

        // Artista no título ou canal (+30 pontos)
        if (titleLower.includes(artistLower) ||
            result.author.toLowerCase().includes(artistLower)) {
            score += 30;
        }

        // "official" no título (+20 pontos)
        if (titleLower.includes('official')) score += 20;

        // Penalizar remixes, covers, live (-50 pontos)
        if (/(remix|cover|live|karaoke|instrumental|piano)/i.test(titleLower) && !trackLower.includes('remix') && !trackLower.includes('live')) {
            score -= 50;
        }

        // Preferir vídeos com mais views (normalizado)
        score += Math.min(result.viewCount / 1000000, 10); // Max +10 pontos

        return { ...result, score };
    });

    // Ordenar por score e retornar o melhor
    scored.sort((a, b) => b.score - a.score);

    return scored[0];
}

module.exports = { searchInvidious };
