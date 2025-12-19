const fs = require('fs');
const path = require('path');
const os = require('os');

const TEMP_DIR = process.env.TEMP_DIR || path.join(os.tmpdir(), 'spotify-dl');

// Configuration
const CHECK_INTERVAL = 10 * 60 * 1000; // Check every 10 minutes
const FILE_LIFETIME = 30 * 60 * 1000;  // Delete files older than 30 minutes

function cleanTempFolder() {
    console.log('[Cleanup] Running garbage collection on temp folder...');
    if (!fs.existsSync(TEMP_DIR)) return;

    try {
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        let deletedCount = 0;

        files.forEach(file => {
            const filePath = path.join(TEMP_DIR, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > FILE_LIFETIME) {
                    if (stats.isDirectory()) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(filePath);
                    }
                    console.log(`[Cleanup] Deleted expired item: ${file}`);
                    deletedCount++;
                }
            } catch (err) {
                // Ignore errors
            }
        });

        if (deletedCount > 0) {
            console.log(`[Cleanup] Removed ${deletedCount} items.`);
        }
    } catch (error) {
        console.error('[Cleanup] Error scanning temp directory:', error);
    }
}

function initCleanup() {
    console.log(`[Cleanup] Initialized. Check every 10m, delete older than 30m.`);
    // Run immediate check
    cleanTempFolder();
    // Schedule
    setInterval(cleanTempFolder, CHECK_INTERVAL);
}

module.exports = { initCleanup };
