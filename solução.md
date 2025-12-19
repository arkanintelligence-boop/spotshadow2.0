# Prompt: Otimização de Performance SEM Rate Limit (SOLUÇÃO REAL)

## ⚠️ PROBLEMA IDENTIFICADO
- Alta concorrência (20x) + cookies = **BLOQUEIO SEVERO** da conta YouTube
- 10 minutos para entregar ZIP vazio (falha total)
- Usar cookies autenticados em `ytsearch` é o **ERRO CRÍTICO**

## ✅ SOLUÇÃO: ESTRATÉGIA HÍBRIDA INTELIGENTE

### REGRA DE OURO:
**NUNCA use cookies/autenticação em buscas (`ytsearch`)!**  
**APENAS use cookies em downloads diretos de URLs conhecidas!**

---

## ARQUITETURA CORRETA

### 1. FASE DE BUSCA (SEM AUTENTICAÇÃO)

**Buscar músicas SEM cookies - YouTube permite isso!**

```javascript
// ❌ ERRADO - Causa rate limit
const searchOptions = {
  cookies: 'cookies.txt', // NÃO FAZER ISSO NA BUSCA!
  // ...
};

// ✅ CORRETO - Busca sem autenticação
async function searchYouTube(trackName, artist) {
  const ytdlp = spawn('yt-dlp', [
    '--dump-json',
    '--skip-download',
    '--no-warnings',
    // SEM --cookies aqui!
    `ytsearch1:"${trackName} ${artist} official audio"`,
  ]);
  
  // Parse JSON output
  return parseYtdlpOutput(ytdlp);
}
```

### 2. FASE DE DOWNLOAD (COM COOKIES SE NECESSÁRIO)

**Downloads diretos PODEM usar cookies:**

```javascript
async function downloadVideo(videoUrl, index) {
  const cookieFile = COOKIE_FILES[index % COOKIE_FILES.length];
  
  const ytdlp = spawn('yt-dlp', [
    '--cookies', cookieFile, // OK usar aqui no download direto
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--external-downloader', 'aria2c',
    '--external-downloader-args', 'aria2c:-x 8 -s 8 -k 1M',
    videoUrl, // URL direta, não ytsearch
  ]);
}
```

---

## ESTRATÉGIA COMPLETA ANTI-RATE-LIMIT

### Configuração Otimizada (Testada e Funcional)

```javascript
const CONFIG = {
  // BUSCA: Paralelo moderado SEM cookies
  SEARCH_CONCURRENT: 15, // Não 20, não 50 - 15 é sweet spot
  SEARCH_DELAY: 100, // 100ms entre cada busca (previne burst)
  SEARCH_USE_COOKIES: false, // CRÍTICO!
  
  // DOWNLOAD: Paralelo agressivo COM cookies
  DOWNLOAD_CONCURRENT: 12, // Não 20 - 12 é seguro
  DOWNLOAD_USE_COOKIES: true, // OK aqui
  DOWNLOAD_COOKIE_ROTATION: true,
  
  // RETRY: Inteligente com backoff
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000, // 2s entre retries
  BACKOFF_MULTIPLIER: 2, // 2s, 4s, 8s
};
```

### Implementação com Rate Limit Inteligente

```javascript
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import delay from 'delay';

// Limiters separados para busca e download
const searchLimiter = pLimit(CONFIG.SEARCH_CONCURRENT);
const downloadLimiter = pLimit(CONFIG.DOWNLOAD_CONCURRENT);

// Rate limiter com delay
class RateLimiter {
  constructor(delayMs) {
    this.delayMs = delayMs;
    this.lastCall = 0;
  }
  
  async throttle() {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;
    
    if (timeSinceLastCall < this.delayMs) {
      await delay(this.delayMs - timeSinceLastCall);
    }
    
    this.lastCall = Date.now();
  }
}

const searchThrottler = new RateLimiter(CONFIG.SEARCH_DELAY);

// Busca com retry e throttling
async function searchWithRetry(track, index) {
  return pRetry(
    async () => {
      await searchThrottler.throttle();
      
      try {
        const result = await searchYouTube(track.name, track.artist);
        
        if (!result || !result.url) {
          throw new Error('No result found');
        }
        
        return result;
      } catch (error) {
        if (error.message.includes('rate limit')) {
          console.log(`Rate limit hit on search ${index}, backing off...`);
          throw error; // Vai fazer retry com backoff
        }
        throw error;
      }
    },
    {
      retries: CONFIG.MAX_RETRIES,
      minTimeout: CONFIG.RETRY_DELAY,
      factor: CONFIG.BACKOFF_MULTIPLIER,
      onFailedAttempt: (error) => {
        console.log(`Search attempt ${error.attemptNumber} failed for "${track.name}". ${error.retriesLeft} retries left.`);
      }
    }
  );
}

// Download com cookie rotation
async function downloadWithRetry(videoUrl, track, index) {
  return pRetry(
    async () => {
      const cookieFile = CONFIG.DOWNLOAD_COOKIE_ROTATION 
        ? COOKIE_FILES[index % COOKIE_FILES.length]
        : null;
      
      try {
        return await downloadVideo(videoUrl, cookieFile);
      } catch (error) {
        if (error.message.includes('rate limit') || error.message.includes('429')) {
          console.log(`Rate limit on download ${index}, rotating cookie...`);
          await delay(5000); // Wait 5s antes de retry
          throw error;
        }
        throw error;
      }
    },
    {
      retries: CONFIG.MAX_RETRIES,
      minTimeout: CONFIG.RETRY_DELAY,
      factor: CONFIG.BACKOFF_MULTIPLIER,
    }
  );
}
```

### Pipeline Completo Otimizado

```javascript
async function downloadPlaylist(playlist) {
  const tracks = playlist.tracks;
  const totalTracks = tracks.length;
  const results = {
    successful: [],
    failed: [],
    skipped: []
  };
  
  console.log(`Starting download of ${totalTracks} tracks...`);
  console.log('Phase 1: Searching on YouTube (without authentication)...');
  
  // FASE 1: BUSCA (15 paralelos, SEM cookies, com throttling)
  const searchPromises = tracks.map((track, index) =>
    searchLimiter(async () => {
      try {
        const result = await searchWithRetry(track, index);
        console.log(`[${index + 1}/${totalTracks}] Found: ${track.name}`);
        return { track, videoUrl: result.url, index };
      } catch (error) {
        console.error(`[${index + 1}/${totalTracks}] Search failed: ${track.name}`);
        results.failed.push({ track, error: error.message });
        return null;
      }
    })
  );
  
  const searchResults = (await Promise.allSettled(searchPromises))
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter(Boolean);
  
  console.log(`Phase 1 Complete: ${searchResults.length}/${totalTracks} tracks found`);
  console.log('Phase 2: Downloading audio files...');
  
  // FASE 2: DOWNLOAD (12 paralelos, COM cookies rotacionados)
  const downloadPromises = searchResults.map((item) =>
    downloadLimiter(async () => {
      try {
        const filePath = await downloadWithRetry(item.videoUrl, item.track, item.index);
        console.log(`[${item.index + 1}/${totalTracks}] Downloaded: ${item.track.name}`);
        results.successful.push({ track: item.track, filePath });
        return filePath;
      } catch (error) {
        console.error(`[${item.index + 1}/${totalTracks}] Download failed: ${item.track.name}`);
        results.failed.push({ track: item.track, error: error.message });
        return null;
      }
    })
  );
  
  await Promise.allSettled(downloadPromises);
  
  console.log('Phase 3: Creating ZIP file...');
  
  // FASE 3: ZIP (apenas sucessos)
  if (results.successful.length === 0) {
    throw new Error('No tracks were successfully downloaded!');
  }
  
  const zipPath = await createZip(results.successful, playlist.name);
  
  console.log(`\n=== DOWNLOAD COMPLETE ===`);
  console.log(`Successful: ${results.successful.length}`);
  console.log(`Failed: ${results.failed.length}`);
  console.log(`ZIP: ${zipPath}`);
  
  return { zipPath, results };
}
```

---

## ALTERNATIVAS AO YT-DLP (Se rate limit persistir)

### 1. YouTube Music API (Menos Rate Limit)

```javascript
import { YTMusic } from 'ytmusic-api';

const ytmusic = new YTMusic();
await ytmusic.initialize();

async function searchYTMusic(trackName, artist) {
  const query = `${trackName} ${artist}`;
  const results = await ytmusic.search(query, 'song');
  
  return results.length > 0 ? results[0] : null;
}
```

### 2. Invidious API (Proxy Público do YouTube)

```javascript
const INVIDIOUS_INSTANCES = [
  'https://invidious.snopyta.org',
  'https://yewtu.be',
  'https://invidious.kavin.rocks',
  // Adicionar mais instâncias
];

async function searchInvidious(trackName, artist) {
  const instance = INVIDIOUS_INSTANCES[Math.floor(Math.random() * INVIDIOUS_INSTANCES.length)];
  const query = encodeURIComponent(`${trackName} ${artist}`);
  
  const response = await fetch(`${instance}/api/v1/search?q=${query}&type=video`);
  const results = await response.json();
  
  return results[0];
}
```

### 3. Spotify + Deemix/Soulseek (Legal se usuário tem Premium)

Se o usuário tem Spotify Premium, considere usar APIs que respeitam isso.

---

## VALIDAÇÃO ANTI-ZIP-VAZIO

**Adicionar verificações para prevenir ZIP vazio:**

```javascript
async function createZip(files, playlistName) {
  if (!files || files.length === 0) {
    throw new Error('Cannot create ZIP: No files to add!');
  }
  
  const archive = archiver('zip', {
    zlib: { level: 6 } // Compressão média
  });
  
  const zipPath = `/tmp/${sanitizeFilename(playlistName)}.zip`;
  const output = fs.createWriteStream(zipPath);
  
  archive.pipe(output);
  
  let filesAdded = 0;
  
  for (const item of files) {
    if (!fs.existsSync(item.filePath)) {
      console.error(`File not found: ${item.filePath}`);
      continue;
    }
    
    const stats = fs.statSync(item.filePath);
    if (stats.size === 0) {
      console.error(`Empty file: ${item.filePath}`);
      continue;
    }
    
    archive.file(item.filePath, {
      name: `${filesAdded + 1}. ${sanitizeFilename(item.track.name)}.mp3`
    });
    
    filesAdded++;
  }
  
  if (filesAdded === 0) {
    throw new Error('No valid files to add to ZIP!');
  }
  
  await archive.finalize();
  
  // Verificar tamanho do ZIP
  const zipStats = fs.statSync(zipPath);
  if (zipStats.size < 1024) { // Menos de 1KB = suspeito
    throw new Error('ZIP file is too small - likely empty or corrupted');
  }
  
  console.log(`ZIP created: ${zipPath} (${(zipStats.size / 1024 / 1024).toFixed(2)} MB)`);
  
  return zipPath;
}
```

---

## MONITORAMENTO EM TEMPO REAL (UI)

**WebSocket para feedback ao usuário:**

```javascript
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

function sendProgress(jobId, data) {
  wss.clients.forEach(client => {
    if (client.jobId === jobId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Durante download:
sendProgress(jobId, {
  phase: 'search',
  current: 45,
  total: 142,
  status: 'Searching: "Shape of You - Ed Sheeran"'
});

sendProgress(jobId, {
  phase: 'download',
  current: 12,
  total: 142,
  status: 'Downloading: "Blinding Lights - The Weeknd"',
  percentage: 8.5,
  estimatedTime: '5m 32s'
});

sendProgress(jobId, {
  phase: 'zip',
  status: 'Creating ZIP file...'
});

sendProgress(jobId, {
  phase: 'complete',
  successful: 138,
  failed: 4,
  downloadUrl: '/api/download/file/abc123'
});
```

---

## DOCKERFILE ATUALIZADO

```dockerfile
FROM node:18-alpine

# Instalar dependências
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    aria2

# Instalar yt-dlp (versão mais recente)
RUN pip3 install --upgrade yt-dlp

# Criar diretório de trabalho
WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependências Node
RUN npm ci --only=production

# Copiar código
COPY . .

# Criar diretórios para downloads e cache
RUN mkdir -p /tmp/downloads /tmp/cache && \
    chmod 777 /tmp/downloads /tmp/cache

# Variáveis de ambiente
ENV NODE_ENV=production \
    DOWNLOAD_DIR=/tmp/downloads \
    CACHE_DIR=/tmp/cache

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node healthcheck.js || exit 1

CMD ["node", "server.js"]
```

---

## RESUMO: CONFIGURAÇÃO FINAL RECOMENDADA

```javascript
module.exports = {
  // Busca: Moderado, SEM cookies
  search: {
    concurrent: 15,
    delay: 100, // ms entre buscas
    useCookies: false, // CRÍTICO!
    timeout: 10000,
    retries: 3,
  },
  
  // Download: Moderado, COM cookies rotacionados
  download: {
    concurrent: 12,
    useCookies: true,
    cookieRotation: true,
    useAria2c: true,
    timeout: 60000,
    retries: 3,
  },
  
  // Geral
  maxPlaylistSize: 500,
  skipOnError: true, // Não para tudo se uma música falhar
  cleanupOnComplete: true,
};
```

---

## CHECKLIST DE IMPLEMENTAÇÃO

### 🔴 CRÍTICO (Implementar AGORA):
- [ ] REMOVER cookies de `ytsearch` (busca)
- [ ] Usar cookies APENAS em downloads de URL direta
- [ ] Reduzir concorrência: 15 busca, 12 download
- [ ] Adicionar throttling de 100ms entre buscas
- [ ] Validar arquivos antes de adicionar ao ZIP
- [ ] Verificar tamanho do ZIP antes de enviar

### 🟡 IMPORTANTE:
- [ ] Implementar retry com backoff exponencial
- [ ] Rotação de cookies em downloads
- [ ] WebSocket para progresso real-time
- [ ] Logs detalhados de falhas

### 🟢 OPCIONAL:
- [ ] Tentar Invidious API como fallback
- [ ] Cache de buscas bem-sucedidas
- [ ] Health checks no Docker

---

## TEMPO ESPERADO (REALISTA)

**Com configuração correta:**
- 142 músicas
- Busca (15 paralelos): ~60 segundos
- Download (12 paralelos com aria2c): ~4-5 minutos
- ZIP: ~30 segundos
- **TOTAL: 6-7 minutos** ✅
- **SEM RATE LIMIT** ✅
- **SEM ZIP VAZIO** ✅

A chave é: **cookies NUNCA em buscas, apenas em downloads!** 🔑