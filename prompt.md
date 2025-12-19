# Prompt para Criação de Spotify Playlist Downloader

## Objetivo
Criar um sistema completo de download de playlists do Spotify usando YouTube como fonte de áudio, com interface web moderna, processamento paralelo eficiente e zero bugs.

## Requisitos Técnicos

### Stack Recomendada
- **Backend**: Node.js com Express ou Python com FastAPI
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla ou React simples)
- **APIs**: Spotify Web API + youtube-dl/yt-dlp
- **Containerização**: Docker + Dockerfile para deploy no Easypanel via GitHub

### Funcionalidades Obrigatórias

#### 1. Extração de Dados do Spotify
- Aceitar URL de playlist pública do Spotify
- Extrair usando Spotify Web API:
  - Nome da playlist
  - Lista completa de músicas (nome + artista principal)
  - Capa de cada música (URL da imagem)
  - Metadados adicionais (álbum, ano, duração)
- **Importante**: Usar autenticação Client Credentials do Spotify (não requer login do usuário)

#### 2. Busca e Download do YouTube
- Para cada música:
  - Buscar no YouTube: `"{nome da música} {artista} official audio"` ou `"{nome da música} {artista} audio"`
  - Implementar algoritmo de matching inteligente:
    - Verificar duração do vídeo (deve estar próxima da duração no Spotify ±30 segundos)
    - Priorizar vídeos oficiais, topic channels e audio channels
    - Evitar remixes, covers, versões ao vivo (a menos que seja isso que está no Spotify)
    - Blacklist de termos: "remix", "cover", "live", "karaoke", "instrumental" (exceto se no título original)
- Usar **yt-dlp** (mais estável que youtube-dl)
- Formato de download: MP3 320kbps ou melhor
- Adicionar metadados ID3 tags:
  - Título da música
  - Artista
  - Álbum
  - Ano
  - Capa (embed da imagem)

#### 3. Processamento Paralelo e Performance
- **Crítico**: Baixar múltiplas músicas simultaneamente (5-10 downloads paralelos)
- Implementar queue system com workers
- Timeout por música: 60 segundos máximo
- Se uma música falhar após 3 tentativas, pular e logar erro
- Progress tracking em tempo real via WebSocket ou Server-Sent Events (SSE)
- Cache de buscas do YouTube (opcional mas recomendado)

#### 4. Interface Web

**Página Única com:**
- Campo de input para URL da playlist
- Botão "Baixar Playlist"
- Preview da playlist antes do download:
  - Nome da playlist
  - Quantidade de músicas
  - Lista de músicas com capas
- Área de progresso em tempo real:
  - Barra de progresso geral (X de Y músicas)
  - Lista de músicas sendo processadas agora
  - Status individual: "Buscando...", "Baixando...", "Convertendo...", "Concluído" ou "Erro"
  - Tempo estimado restante
  - Velocidade de download
- Botão de download do ZIP quando concluído
- Design moderno e responsivo (mobile-friendly)

#### 5. Geração do Arquivo ZIP
- Nome do arquivo: `{Nome_da_Playlist}.zip`
- Estrutura interna:
  ```
  Nome_da_Playlist/
  ├── 01 - Artista - Nome da Música.mp3
  ├── 02 - Artista - Nome da Música.mp3
  ├── ...
  └── playlist_info.json (metadados)
  ```
- Limpar caracteres especiais nos nomes de arquivo
- Ordem das músicas igual à playlist original
- Adicionar arquivo JSON com informações da playlist

#### 6. Tratamento de Erros Robusto

**Prevenir bugs comuns:**
- Música não encontrada no YouTube → Tentar variações de busca → Se falhar, adicionar ao log de erros mas continuar
- Caracteres especiais em nomes → Sanitização adequada
- Timeout em downloads → Implementar retry com exponential backoff
- Vídeos bloqueados por região → Usar proxies ou pular
- Playlist privada → Mostrar erro claro ao usuário
- Rate limiting do YouTube → Implementar delays inteligentes
- Múltiplos resultados similares → Escolher o mais adequado por duração e title match

**Log detalhado:**
- Arquivo de log para cada download
- Salvar músicas que falharam com motivo
- Disponibilizar relatório ao final

### Arquitetura do Sistema

```
┌─────────────────┐
│   Frontend      │
│   (HTML/JS)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   API Server    │
│  (Express/FastAPI)│
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│Spotify │ │ YouTube  │
│  API   │ │ (yt-dlp) │
└────────┘ └──────────┘
    │         │
    └────┬────┘
         ▼
   ┌──────────┐
   │ Worker   │
   │  Queue   │
   └─────┬────┘
         ▼
   ┌──────────┐
   │   ZIP    │
   │ Generator│
   └──────────┘
```

### Endpoints da API

1. `POST /api/playlist/analyze`
   - Input: `{ "url": "spotify_playlist_url" }`
   - Output: Informações da playlist

2. `POST /api/playlist/download`
   - Input: `{ "url": "spotify_playlist_url" }`
   - Output: `{ "job_id": "uuid" }`

3. `GET /api/download/status/:job_id`
   - Output: Status em tempo real via SSE

4. `GET /api/download/file/:job_id`
   - Output: Arquivo ZIP

### Variáveis de Ambiente
```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
PORT=3000
MAX_CONCURRENT_DOWNLOADS=8
DOWNLOAD_TIMEOUT=60000
TEMP_DIR=/tmp/downloads
```

### Dockerfile
```dockerfile
FROM node:18-alpine (ou python:3.11-slim)
# Instalar ffmpeg e yt-dlp
RUN apk add --no-cache ffmpeg python3 py3-pip
RUN pip3 install yt-dlp
# Copiar aplicação e instalar dependências
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## Melhorias de Performance

1. **Cache Redis (Opcional)**: Cache de buscas do YouTube por 7 dias
2. **CDN para Assets**: Servir frontend via CDN
3. **Compressão**: Gzip/Brotli para respostas HTTP
4. **Stream Processing**: Processar ZIP em streaming para playlists grandes
5. **Rate Limiting**: Limitar requisições por IP

## Checklist de Qualidade

- [ ] Funciona com playlists de 50 músicas em ~5 min
- [ ] Funciona com playlists de 200 músicas em ~15 min
- [ ] Funciona com playlists de 500+ músicas
- [ ] 95%+ de acurácia no matching de músicas
- [ ] UI responsiva e intuitiva
- [ ] Progress tracking preciso
- [ ] Tratamento de erros completo
- [ ] Logs detalhados
- [ ] Testes com diferentes gêneros musicais
- [ ] Build do Docker funcional
- [ ] Deploy no Easypanel sem erros
- [ ] README.md completo com instruções

## Estrutura de Diretórios Sugerida
```
spotify-downloader/
├── backend/
│   ├── server.js (ou main.py)
│   ├── routes/
│   ├── services/
│   │   ├── spotify.js
│   │   ├── youtube.js
│   │   └── downloader.js
│   ├── utils/
│   └── workers/
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

## Bibliotecas Recomendadas

**Node.js:**
- `express` - API server
- `spotify-web-api-node` - Spotify integration
- `yt-dlp-wrap` ou `youtube-dl-exec` - YouTube download
- `archiver` - ZIP generation
- `fluent-ffmpeg` - Audio processing
- `node-id3` - MP3 metadata

**Python:**
- `fastapi` - API server
- `spotipy` - Spotify integration
- `yt-dlp` - YouTube download
- `mutagen` - Audio metadata
- `aiofiles` - Async file operations

## Referências de Repositórios
Pesquise no GitHub por:
- "spotify playlist downloader"
- "spotify to mp3"
- "youtube-dl playlist"
- "spotify youtube download"

Analise os melhores e combine as soluções mais eficientes.

---

**IMPORTANTE**: O sistema deve ser 100% funcional, rápido e sem bugs. Priorize qualidade do matching de músicas sobre velocidade bruta. Implemente logs detalhados para debug. Teste com playlists reais de diferentes tamanhos antes de considerar completo.