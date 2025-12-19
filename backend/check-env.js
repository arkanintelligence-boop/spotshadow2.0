const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

console.log('--- Environment Check ---');

// 1. Try to load .env from different possible locations
const pathsToCheck = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env')
];

let envLoaded = false;
for (const p of pathsToCheck) {
    if (fs.existsSync(p)) {
        console.log(`Found .env file at: ${p}`);
        const result = dotenv.config({ path: p });
        if (result.error) {
            console.error(`Error loading .env at ${p}:`, result.error);
        } else {
            envLoaded = true;
            // Merge to process.env explicitly to be sure
            for (const k in result.parsed) {
                process.env[k] = result.parsed[k];
            }
        }
    }
}

if (!envLoaded) {
    console.warn('⚠️ No .env file found in standard locations!');
}

// 2. Check for YouTube Keys
const keys = [
    process.env.YOUTUBE_API_KEY_1,
    process.env.YOUTUBE_API_KEY_2,
    process.env.YOUTUBE_API_KEY_3,
    process.env.YOUTUBE_API_KEY_4,
    process.env.YOUTUBE_API_KEY_5
].filter(Boolean);

console.log(`Loaded ${keys.length} YouTube API Keys.`);

if (keys.length === 0) {
    console.error('❌ CRITICAL: No YouTube API keys found in environment variables.');
    console.error('Please check your .env file and ensure YOUTUBE_API_KEY_1 is set and NOT commented out.');
    console.log('PORT Check:', process.env.PORT);
    console.log('All Env Keys:', Object.keys(process.env).sort());
    process.exit(1);
} else {
    console.log('✅ YouTube keys detected correctly.');
    keys.forEach((k, i) => {
        console.log(`  Key ${i + 1}: ${k.substring(0, 5)}...`);
    });
}
console.log('-------------------------');
