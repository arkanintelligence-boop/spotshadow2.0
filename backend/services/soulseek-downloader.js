const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);

const CONFIG = {
    DOWNLOAD_DIR: process.env.TEMP_DIR || '/tmp/downloads',
    SOULSEEK_USER: process.env.SOULSEEK_USER || '',
    SOULSEEK_PASS: process.env.SOULSEEK_PASS || '',
    CONFIG_FILE: '/tmp/sldl.conf',
};

// Criar arquivo de configuração do sldl
function createSldlConfig() {
    const config = `
[main]
user=${CONFIG.SOULSEEK_USER}
pass=${CONFIG.SOULSEEK_PASS}

[input]
spotify=true

[download]
path=${CONFIG.DOWNLOAD_DIR}
concurrent-downloads=8
fast-search=true

[output]
name-format={artist} - {title}
skip-existing=true
# Move to job subfolder will be handled by -p flag in spawn

[filter]
format=mp3,flac
min-bitrate=320

[search]
searches-per-time=34
searches-renew-time=220
`;

    fs.writeFileSync(CONFIG.CONFIG_FILE, config);
}

async function downloadPlaylistSoulseek(spotifyUrl, io, jobId) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  DOWNLOAD VIA SOULSEEK FOR JOB ${jobId}`);
    console.log(`${'='.repeat(60)}\n`);

    // Criar config
    createSldlConfig();

    const startTime = Date.now();
    const outputDir = path.join(CONFIG.DOWNLOAD_DIR, jobId);

    // Criar diretório
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
        // Check credentials
        if (!CONFIG.SOULSEEK_USER || !CONFIG.SOULSEEK_PASS) {
            return reject(new Error("Soulseek credentials missing from .env (SOULSEEK_USER, SOULSEEK_PASS)"));
        }

        // Executar sldl
        // sldl [url] -c config -p outputDir
        const sldl = spawn('sldl', [
            spotifyUrl,
            '-c', CONFIG.CONFIG_FILE,
            '-p', outputDir,
            '--concurrent-downloads', '8',
            '--fast-search',
            '--no-modify-shareDir',
            '--skip-existing'
        ]);

        let currentTrack = '';
        let completedTracks = 0;
        let totalTracks = 0;

        // Parsear output
        sldl.stdout.on('data', (data) => {
            const output = data.toString();
            // console.log(output); // Verbose log

            // Detectar total de tracks
            // Output example: "Found 142 tracks from Spotify" (Need to verify actual output)
            // Assuming regex from MD is correct: /(\d+) tracks/
            const totalMatch = output.match(/(\d+) tracks/);
            if (totalMatch && totalTracks === 0) {
                totalTracks = parseInt(totalMatch[1]);
                io.emit(`status:${jobId}`, {
                    type: 'progress',
                    completed: 0,
                    total: totalTracks,
                    percent: 0,
                    status: 'Searching/Downloading...'
                });
            }

            // Detectar track atual
            // Downloading: Artist - Title
            const trackMatch = output.match(/Downloading: (.+)/);
            if (trackMatch) {
                currentTrack = trackMatch[1].trim();
                // Emit update
                io.emit(`status:${jobId}`, {
                    type: 'track_update',
                    trackId: 'unknown', // Soulseek doesn't give ID, effectively
                    status: `Downloading ${currentTrack}`
                });
            }

            // Detectar conclusão de uma faixa
            // "Downloaded: Artist - Title" or "Success"
            if (output.includes('Downloaded') || output.includes('Success') || output.includes('Done')) {
                completedTracks++;
                io.emit(`status:${jobId}`, {
                    type: 'progress',
                    completed: completedTracks,
                    total: totalTracks,
                    percent: totalTracks > 0 ? Math.round((completedTracks / totalTracks) * 100) : 0
                });
            }
        });

        let stderr = '';
        sldl.stderr.on('data', (data) => {
            stderr += data.toString();
            console.error(`[SLDL ERR] ${data.toString()}`);
        });

        sldl.on('close', (code) => {
            const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

            if (code === 0) {
                // Listar arquivos baixados
                const files = fs.readdirSync(outputDir)
                    .filter(f => f.endsWith('.mp3') || f.endsWith('.flac'))
                    .map(f => ({
                        success: true,
                        filePath: path.join(outputDir, f),
                        track: { name: f.replace(/\.[^/.]+$/, "") }
                    }));

                console.log(`\n${'='.repeat(60)}`);
                console.log(`  DOWNLOAD CONCLUÍDO`);
                console.log(`${'='.repeat(60)}`);
                console.log(`✅ Baixados: ${files.length}/${totalTracks || files.length}`);
                console.log(`⏱️  Tempo: ${totalTime} minutos`);
                console.log(`${'='.repeat(60)}\n`);

                resolve({
                    successful: files,
                    failed: [],
                    total: totalTracks || files.length,
                    timeMinutes: totalTime,
                });
            } else {
                reject(new Error(`sldl exited with code ${code}. Stderr: ${stderr}`));
            }
        });

        sldl.on('error', reject);
    });
}

module.exports = { downloadPlaylistSoulseek };
