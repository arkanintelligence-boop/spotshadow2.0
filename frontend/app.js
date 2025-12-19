const socket = io();
let currentPlaylist = null;
let currentJobId = null;

const elements = {
    inputSection: document.getElementById('input-section'),
    previewSection: document.getElementById('preview-section'),
    progressSection: document.getElementById('progress-section'),
    resultSection: document.getElementById('result-section'),
    loading: document.getElementById('loading'),
    urlInput: document.getElementById('playlist-url'),
    analyzeBtn: document.getElementById('analyze-btn'),
    downloadBtn: document.getElementById('download-btn'),
    tracksBody: document.getElementById('tracks-body'),
    plName: document.getElementById('pl-name'),
    plCount: document.getElementById('pl-count'),
    progressBar: document.getElementById('main-progress'),
    progressText: document.getElementById('progress-text'),
    progressCount: document.getElementById('progress-count'),
    statusLog: document.getElementById('current-status'),
    downloadLink: document.getElementById('download-link'),
    resetBtn: document.getElementById('reset-btn'),
    resetNavBtn: document.getElementById('reset-nav-btn')
};

function setLoading(isLoading) {
    if (isLoading) {
        elements.inputSection.classList.add('hidden');
        elements.loading.classList.remove('hidden');
    } else {
        elements.loading.classList.add('hidden');
    }
}

async function analyzePlaylist() {
    const url = elements.urlInput.value.trim();
    if (!url) return alert("Por favor, insira uma URL válida do Spotify");

    setLoading(true);

    try {
        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const data = await res.json();
        if (data.error) throw new Error(data.details ? `${data.error}: ${data.details}` : data.error);

        currentPlaylist = data;
        renderPreview(data);
    } catch (err) {
        alert("Erro: " + err.message);
        setLoading(false);
        elements.inputSection.classList.remove('hidden');
    }
}

function renderPreview(data) {
    setLoading(false);
    elements.inputSection.classList.add('hidden');
    elements.previewSection.classList.remove('hidden');

    elements.plName.textContent = data.name;
    elements.plCount.textContent = `${data.total} músicas`;

    elements.tracksBody.innerHTML = data.tracks.map((track, i) => `
        <div class="track-row" id="track-${track.id}">
            <div class="t-num">${i + 1}</div>
            <div class="t-info">
                <img src="${track.image || ''}" loading="lazy" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDQwIDQwIj48cmVjdCB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIGZpbGw9IiMzMzMiLz48L3N2Zz4='">
                <div class="t-text">
                    <span class="t-title">${track.name}</span>
                    <span class="t-artist">${track.artist}</span>
                </div>
            </div>
            <div class="t-album">${track.album}</div>
            <div class="t-status" id="status-${track.id}">Aguardando...</div>
        </div>
    `).join('');
}

async function startDownload() {
    if (!currentPlaylist) return;

    // Hide details, show progress
    // elements.previewSection.classList.add('hidden'); 
    // KEEP PREVIEW VISIBLE but show progress overlay or scroll to it
    elements.previewSection.classList.add('hidden');
    elements.progressSection.classList.remove('hidden');

    try {
        const res = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tracks: currentPlaylist.tracks,
                playlistName: currentPlaylist.name
            })
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        currentJobId = data.jobId;
        listenToJob(currentJobId);

    } catch (err) {
        alert("Falha ao iniciar: " + err.message);
        location.reload();
    }
}

function translateStatus(status) {
    if (status === 'Searching...') return 'Buscando...';
    if (status === 'Downloading...') return 'Baixando...';
    if (status === 'Tagging...') return 'Etiquetando...';
    if (status === 'Done') return 'Concluído';
    if (status === 'Error') return 'Erro';
    return status;
}

function listenToJob(jobId) {
    socket.on(`status:${jobId}`, (data) => {
        if (data.type === 'progress') {
            elements.progressBar.style.width = `${data.percent}%`;
            elements.progressText.textContent = `${data.percent}%`;
            elements.progressCount.textContent = `${data.completed}/${data.total}`;
        } else if (data.type === 'track_update') {
            const statusEl = document.getElementById(`status-${data.trackId}`);
            if (statusEl) {
                const ptStatus = translateStatus(data.status);
                statusEl.textContent = ptStatus;

                if (data.status === 'Done') statusEl.style.color = '#1DB954';
                if (data.status === 'Error') statusEl.style.color = '#e91429';
            }
            elements.statusLog.textContent = `Processando: ...`;
        } else if (data.type === 'zipping') {
            elements.statusLog.textContent = "Criando arquivo ZIP. Por favor aguarde...";
        } else if (data.type === 'ready') {
            finishDownload(data.url);
        } else if (data.type === 'error') {
            alert("Erro: " + data.message);
        }
    });
}

function finishDownload(url) {
    elements.progressSection.classList.add('hidden');
    elements.resultSection.classList.remove('hidden');
    elements.downloadLink.href = url;
}

function resetApp() {
    location.reload();
}

elements.analyzeBtn.addEventListener('click', analyzePlaylist);
elements.downloadBtn.addEventListener('click', startDownload);
elements.resetBtn.addEventListener('click', resetApp);
if (elements.resetNavBtn) elements.resetNavBtn.addEventListener('click', resetApp);

elements.urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') analyzePlaylist();
});
