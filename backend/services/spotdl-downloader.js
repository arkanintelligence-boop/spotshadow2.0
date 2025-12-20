const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    DOWNLOAD_DIR: '/tmp/downloads',
};

async function downloadPlaylistSpotdl(spotifyUrl, jobId, onProgress) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  DOWNLOAD VIA spotDL - JOB ${jobId}`);
    console.log(`${'='.repeat(60)}\n`);

    const startTime = Date.now();
    const outputDir = path.join(CONFIG.DOWNLOAD_DIR, jobId);

    // Criar diretório
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
        // Executar spotdl
        // spotdl download [url] --output [dir] --format mp3 --threads 8
        const spotdl = spawn('spotdl', [
            'download',
            spotifyUrl,
            '--output', outputDir,
            '--format', 'mp3',
            '--bitrate', '320k',
            '--threads', '8',
            '--print-errors',
        ]);

        let totalTracks = 0;
        let completedTracks = 0;
        let currentTrack = '';

        // Capturar output
        spotdl.stdout.on('data', (data) => {
            const output = data.toString();
            // console.log(output);

            // Detectar total
            // Found X songs in ...
            const totalMatch = output.match(/Found (\d+) songs/);
            if (totalMatch && totalTracks === 0) {
                totalTracks = parseInt(totalMatch[1]);
                onProgress?.({
                    type: 'status',
                    phase: 'started',
                    total: totalTracks,
                    message: `Found ${totalTracks} songs`
                });
            }

            // Detectar progresso (spotDL output varies, assume standard)
            // "Downloaded "Song Name" (X/Y)"
            // Or regex provided in prompt: /(\d+)\/(\d+)/
            const progressMatch = output.match(/(\d+)\/(\d+)/);
            if (progressMatch) {
                completedTracks = parseInt(progressMatch[1]);
                const total = parseInt(progressMatch[2]);

                onProgress?.({
                    type: 'progress',
                    current: completedTracks,
                    total: total,
                    track: currentTrack,
                    status: 'downloading',
                    percent: Math.round((completedTracks / total) * 100)
                });
            }

            // Detectar nome da música
            const trackMatch = output.match(/Downloading:? (.+)/i) || output.match(/Downloaded "(.+)"/);
            if (trackMatch) {
                currentTrack = trackMatch[1].trim();
                onProgress?.({
                    type: 'track_update',
                    track: currentTrack,
                    status: 'Processing...'
                });
            }

            // Detectar conclusão
            if (output.includes('Downloaded') || output.includes('Skipping')) {
                // completedTracks is updated via progress match usually, but fallback if needed
            }
        });

        spotdl.stderr.on('data', (data) => {
            const error = data.toString();
            // console.error('spotDL stderr:', error);
            if (!error.includes('WARNING') && !error.includes('FFmpeg')) {
                // console.error(error);
            }
        });

        spotdl.on('close', (code) => {
            const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

            try {
                // Listar arquivos baixados
                const files = fs.readdirSync(outputDir)
                    .filter(f => f.endsWith('.mp3'))
                    .map(f => ({
                        success: true,
                        filePath: path.join(outputDir, f),
                        track: { name: f.replace('.mp3', '') }
                    }));

                console.log(`\n${'='.repeat(60)}`);
                console.log(`  DOWNLOAD CONCLUÍDO`);
                console.log(`${'='.repeat(60)}`);
                console.log(`✅ Baixados: ${files.length}/${totalTracks || files.length}`);
                console.log(`⏱️  Tempo: ${totalTime} minutos`);
                console.log(`${'='.repeat(60)}\n`);

                // Resolve anyway, backend will zip what exists
                resolve({
                    successful: files,
                    failed: [],
                    total: totalTracks || files.length,
                    timeMinutes: totalTime,
                });

            } catch (error) {
                reject(new Error(`Erro ao processar arquivos: ${error.message}`));
            }
        });

        spotdl.on('error', (error) => {
            reject(new Error(`spotDL error: ${error.message}`));
        });
    });
}

module.exports = { downloadPlaylistSpotdl };
