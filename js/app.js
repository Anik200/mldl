/**
 * Myhem's Lyric Downloader (Mldl) - Application Logic
 * Orchestrates UI interactions, search flows, batch downloads, JSZip archiving, and lyric preview.
 */

// Application State
const state = {
  activeTab: 'album', // 'album' | 'song'
  isSearching: false,
  isDownloading: false,
  downloadAbortController: null,
  albumCandidates: [],
  currentAlbum: null,
  currentAlbumTracks: [],
  selectedTrackIndices: new Set(),
  selectedFormats: {
    ttml: true,
    krc: true,
    'enhanced-lrc': false,
    'standard-lrc': false,
    srt: false,
    json: false
  },
  options: {
    namingTemplate: "{track}. {title}"
  },
  previewData: {
    track: null,
    krcText: '',
    parsed: null,
    isPlaying: false,
    playbackTimer: null,
    currentTimeMs: 0,
    durationMs: 0,
    activeTab: 'karaoke'
  }
};

// Cloudflare Worker Code template for 1-click copying
const WORKER_CODE_TEMPLATE = `export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response("Missing 'url' query parameter", {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*"
        }
      });

      const responseBody = await response.arrayBuffer();

      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Cache-Control": "public, max-age=3600"
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
};`;

// DOM Elements cache
let dom = {};

document.addEventListener('DOMContentLoaded', () => {
  initDomReferences();
  loadStoredSettings();
  initEventListeners();
  initFormatPills();
  updateNamingPreview();
  checkHostAndProxyState();
});

/**
 * Cache DOM elements for quick access
 */
function initDomReferences() {
  dom = {
    // Banner
    proxyAlertBanner: document.getElementById('proxy-alert-banner'),
    bannerSetupProxyBtn: document.getElementById('banner-setup-proxy-btn'),

    // Tabs & Forms
    tabAlbumBtn: document.getElementById('tab-album-btn'),
    tabSongBtn: document.getElementById('tab-song-btn'),
    albumSearchForm: document.getElementById('album-search-form'),
    songSearchForm: document.getElementById('song-search-form'),
    albumNameInput: document.getElementById('album-name-input'),
    albumArtistInput: document.getElementById('album-artist-input'),
    songTitleInput: document.getElementById('song-title-input'),
    songArtistInput: document.getElementById('song-artist-input'),
    searchSpinner: document.getElementById('search-spinner'),

    // Containers & Views
    resultsContainer: document.getElementById('results-container'),
    albumCandidatesView: document.getElementById('album-candidates-view'),
    albumCandidatesList: document.getElementById('album-candidates-list'),
    albumView: document.getElementById('album-view'),
    songResultsView: document.getElementById('song-results-view'),
    emptyState: document.getElementById('empty-state'),
    errorState: document.getElementById('error-state'),
    errorMessage: document.getElementById('error-message'),
    errorProxyBtn: document.getElementById('error-proxy-btn'),

    // Album details
    backToAlbumsBtn: document.getElementById('back-to-albums-btn'),
    albumTitle: document.getElementById('album-title'),
    albumArtist: document.getElementById('album-artist'),
    albumMetaInfo: document.getElementById('album-meta-info'),
    trackListTableBody: document.getElementById('tracklist-tbody'),
    selectAllCheckbox: document.getElementById('select-all-tracks'),
    selectedCountBadge: document.getElementById('selected-count-badge'),
    downloadAlbumZipBtn: document.getElementById('download-album-zip-btn'),

    // Single Song Results
    songResultsList: document.getElementById('song-results-list'),

    // Settings Modal
    settingsModal: document.getElementById('settings-modal'),
    openSettingsBtn: document.getElementById('open-settings-btn'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    proxySelect: document.getElementById('proxy-select'),
    customProxyRow: document.getElementById('custom-proxy-row'),
    customWorkerInput: document.getElementById('custom-worker-input'),
    testProxyBtn: document.getElementById('test-proxy-btn'),
    proxyTestStatus: document.getElementById('proxy-test-status'),
    copyWorkerCodeBtn: document.getElementById('copy-worker-code-btn'),
    
    // Naming Format in Settings
    namingPresetSelect: document.getElementById('naming-preset-select'),
    namingTemplateInput: document.getElementById('naming-template-input'),
    namingPreviewLabel: document.getElementById('naming-preview-label'),

    // Preview Modal
    previewModal: document.getElementById('preview-modal'),
    closePreviewBtn: document.getElementById('close-preview-btn'),
    previewSongTitle: document.getElementById('preview-song-title'),
    previewSongArtist: document.getElementById('preview-song-artist'),
    previewTabsContainer: document.getElementById('preview-tabs'),
    previewKaraokePane: document.getElementById('preview-pane-karaoke'),
    previewTextPane: document.getElementById('preview-pane-text'),
    previewTextContent: document.getElementById('preview-text-content'),
    previewPlayBtn: document.getElementById('preview-play-btn'),
    previewScrubber: document.getElementById('preview-scrubber'),
    previewTimeLabel: document.getElementById('preview-time-label'),
    previewCopyBtn: document.getElementById('preview-copy-btn'),
    previewDownloadBtn: document.getElementById('preview-download-btn'),

    // Batch Download Progress Modal
    progressModal: document.getElementById('progress-modal'),
    progressTitle: document.getElementById('progress-title'),
    progressBar: document.getElementById('progress-bar-fill'),
    progressPercentage: document.getElementById('progress-percentage'),
    progressCurrentStatus: document.getElementById('progress-current-status'),
    progressLogList: document.getElementById('progress-log-list'),
    progressCancelBtn: document.getElementById('progress-cancel-btn')
  };
}

/**
 * Check if running on GitHub Pages without configured worker
 */
function checkHostAndProxyState() {
  const isHosted = !isLocalhost;
  if (isHosted && !API_CONFIG.customWorkerUrl) {
    if (dom.proxyAlertBanner) dom.proxyAlertBanner.style.display = 'block';
  } else {
    if (dom.proxyAlertBanner) dom.proxyAlertBanner.style.display = 'none';
  }
}

/**
 * Load settings from localStorage
 */
function loadStoredSettings() {
  try {
    const savedProxy = localStorage.getItem('mldl_proxy');
    if (savedProxy) {
      API_CONFIG.selectedProxy = savedProxy;
      if (dom.proxySelect) dom.proxySelect.value = savedProxy;
    } else {
      if (dom.proxySelect) dom.proxySelect.value = API_CONFIG.selectedProxy;
    }

    const savedCustom = localStorage.getItem('mldl_custom_worker');
    if (savedCustom) {
      API_CONFIG.customWorkerUrl = savedCustom;
      if (dom.customWorkerInput) dom.customWorkerInput.value = savedCustom;
    }

    const savedNaming = localStorage.getItem('mldl_naming_template');
    if (savedNaming) {
      state.options.namingTemplate = savedNaming;
      if (dom.namingTemplateInput) dom.namingTemplateInput.value = savedNaming;
      if (dom.namingPresetSelect) {
        dom.namingPresetSelect.value = ["{track}. {title}", "{artist} - {title}", "{track} - {artist} - {title}", "{title}"].includes(savedNaming)
          ? savedNaming
          : "custom";
      }
    } else {
      if (dom.namingTemplateInput) dom.namingTemplateInput.value = state.options.namingTemplate;
    }

    toggleCustomProxyRow(API_CONFIG.selectedProxy === 'custom');
  } catch (e) {
    console.warn("Could not load localStorage settings:", e);
  }
}

/**
 * Save settings to localStorage
 */
function saveStoredSettings() {
  try {
    localStorage.setItem('mldl_proxy', API_CONFIG.selectedProxy);
    localStorage.setItem('mldl_custom_worker', API_CONFIG.customWorkerUrl);
    localStorage.setItem('mldl_naming_template', state.options.namingTemplate);
  } catch (e) {
    console.warn("Could not save to localStorage:", e);
  }
}

/**
 * Toggle visibility of custom proxy input
 */
function toggleCustomProxyRow(show) {
  if (dom.customProxyRow) {
    dom.customProxyRow.style.display = show ? 'block' : 'none';
  }
}

/**
 * Initialize event listeners
 */
function initEventListeners() {
  // Banner button
  if (dom.bannerSetupProxyBtn) {
    dom.bannerSetupProxyBtn.addEventListener('click', () => {
      dom.settingsModal.showModal();
    });
  }

  if (dom.errorProxyBtn) {
    dom.errorProxyBtn.addEventListener('click', () => {
      dom.settingsModal.showModal();
    });
  }

  // Copy Worker Code Button
  if (dom.copyWorkerCodeBtn) {
    dom.copyWorkerCodeBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(WORKER_CODE_TEMPLATE).then(() => {
        const orig = dom.copyWorkerCodeBtn.textContent;
        dom.copyWorkerCodeBtn.textContent = '✓ Worker Script Copied!';
        setTimeout(() => { dom.copyWorkerCodeBtn.textContent = orig; }, 2000);
      });
    });
  }

  // Tab Switchers
  dom.tabAlbumBtn.addEventListener('click', () => switchTab('album'));
  dom.tabSongBtn.addEventListener('click', () => switchTab('song'));

  // Search Submissions
  dom.albumSearchForm.addEventListener('submit', handleAlbumSearch);
  dom.songSearchForm.addEventListener('submit', handleSongSearch);

  // Settings Modal Controls
  dom.openSettingsBtn.addEventListener('click', () => {
    dom.settingsModal.showModal();
    if (dom.proxyTestStatus) dom.proxyTestStatus.textContent = '';
    updateNamingPreview();
  });
  dom.closeSettingsBtn.addEventListener('click', () => {
    dom.settingsModal.close();
    checkHostAndProxyState();
  });

  dom.proxySelect.addEventListener('change', (e) => {
    API_CONFIG.selectedProxy = e.target.value;
    toggleCustomProxyRow(API_CONFIG.selectedProxy === 'custom');
    saveStoredSettings();
  });

  dom.customWorkerInput.addEventListener('input', (e) => {
    API_CONFIG.customWorkerUrl = e.target.value.trim();
    saveStoredSettings();
    checkHostAndProxyState();
  });

  dom.testProxyBtn.addEventListener('click', handleTestProxy);

  // Naming Format Handlers
  if (dom.namingPresetSelect) {
    dom.namingPresetSelect.addEventListener('change', (e) => {
      if (e.target.value !== 'custom') {
        state.options.namingTemplate = e.target.value;
        dom.namingTemplateInput.value = e.target.value;
      }
      updateNamingPreview();
      saveStoredSettings();
    });
  }

  if (dom.namingTemplateInput) {
    dom.namingTemplateInput.addEventListener('input', (e) => {
      const val = e.target.value.trim() || "{title}";
      state.options.namingTemplate = val;
      if (dom.namingPresetSelect) {
        dom.namingPresetSelect.value = ["{track}. {title}", "{artist} - {title}", "{track} - {artist} - {title}", "{title}"].includes(val)
          ? val
          : "custom";
      }
      updateNamingPreview();
      saveStoredSettings();
    });
  }

  // Tag helper click buttons in settings
  document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tag = e.target.dataset.tag;
      if (dom.namingTemplateInput) {
        dom.namingTemplateInput.value += tag;
        state.options.namingTemplate = dom.namingTemplateInput.value;
        if (dom.namingPresetSelect) dom.namingPresetSelect.value = "custom";
        updateNamingPreview();
        saveStoredSettings();
      }
    });
  });

  // Album Selection & Batch Download
  dom.selectAllCheckbox.addEventListener('change', handleSelectAllToggle);
  dom.downloadAlbumZipBtn.addEventListener('click', handleDownloadAlbumZip);

  if (dom.backToAlbumsBtn) {
    dom.backToAlbumsBtn.addEventListener('click', () => {
      dom.albumView.style.display = 'none';
      dom.albumCandidatesView.style.display = 'block';
    });
  }

  // Progress Modal Cancel / Close Button
  if (dom.progressCancelBtn) {
    dom.progressCancelBtn.addEventListener('click', handleCancelOrCloseDownload);
  }

  // Preview Modal Controls
  dom.closePreviewBtn.addEventListener('click', () => {
    stopPreviewPlayback();
    dom.previewModal.close();
  });

  dom.previewPlayBtn.addEventListener('click', togglePreviewPlayback);
  dom.previewScrubber.addEventListener('input', (e) => {
    state.previewData.currentTimeMs = parseInt(e.target.value, 10);
    updatePreviewPlaybackView();
  });

  dom.previewCopyBtn.addEventListener('click', handleCopyPreviewText);
  dom.previewDownloadBtn.addEventListener('click', handleDownloadPreviewedTrack);

  // Format pills
  document.querySelectorAll('.format-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const fmt = e.target.dataset.format;
      state.selectedFormats[fmt] = e.target.checked;
      updateFormatPillsUI();
    });
  });

  // Crypto Donation Address Copy Buttons
  document.querySelectorAll('.copy-crypto-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetId = e.currentTarget.dataset.target;
      const addrElem = document.getElementById(targetId);
      if (!addrElem) return;
      const text = addrElem.textContent.trim();
      navigator.clipboard.writeText(text).then(() => {
        const origText = e.currentTarget.textContent;
        e.currentTarget.textContent = '✓ Copied';
        e.currentTarget.classList.add('copied');
        setTimeout(() => {
          e.currentTarget.textContent = origText;
          e.currentTarget.classList.remove('copied');
        }, 1800);
      });
    });
  });
}

function initFormatPills() {
  updateFormatPillsUI();
}

function updateFormatPillsUI() {
  document.querySelectorAll('.format-pill').forEach(pill => {
    const input = pill.querySelector('input');
    if (input && input.checked) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}

/**
 * Format filename using user custom pattern
 */
function formatFilename(template, { trackNum = "01", title = "Song Title", artist = "Artist Name", album = "Album Name" }) {
  let pattern = template || "{track}. {title}";
  pattern = pattern.replace(/\{track\}/gi, String(trackNum));
  pattern = pattern.replace(/\{title\}/gi, String(title));
  pattern = pattern.replace(/\{artist\}/gi, String(artist));
  pattern = pattern.replace(/\{album\}/gi, String(album));
  return sanitizeFilename(pattern);
}

/**
 * Update live filename preview in settings
 */
function updateNamingPreview() {
  if (!dom.namingPreviewLabel) return;
  const sample = formatFilename(state.options.namingTemplate, {
    trackNum: "01",
    title: "Hello",
    artist: "Adele",
    album: "25"
  });
  dom.namingPreviewLabel.textContent = `${sample}.ttml`;
}

/**
 * Switch between Album Search & Song Search
 */
function switchTab(tab) {
  state.activeTab = tab;
  if (tab === 'album') {
    dom.tabAlbumBtn.classList.add('active');
    dom.tabSongBtn.classList.remove('active');
    dom.albumSearchForm.style.display = 'block';
    dom.songSearchForm.style.display = 'none';
  } else {
    dom.tabSongBtn.classList.add('active');
    dom.tabAlbumBtn.classList.remove('active');
    dom.albumSearchForm.style.display = 'none';
    dom.songSearchForm.style.display = 'block';
  }
}

/**
 * Test Active Proxy Connectivity
 */
async function handleTestProxy() {
  dom.proxyTestStatus.textContent = 'Testing connection...';
  dom.proxyTestStatus.className = 'proxy-status testing';

  const startTime = Date.now();
  try {
    const testUrl = "http://mobilecdn.kugou.com/api/v3/search/album?format=json&keyword=Adele%2025&page=1&pagesize=1";
    const data = await fetchKugouJson(testUrl, 8000);
    const latency = Date.now() - startTime;
    if (data?.status === 1 || data?.errcode === 0) {
      dom.proxyTestStatus.textContent = `✓ Connected successfully! (${latency}ms)`;
      dom.proxyTestStatus.className = 'proxy-status success';
    } else {
      dom.proxyTestStatus.textContent = `⚠ API warning: ${data?.error || 'Unknown'}`;
      dom.proxyTestStatus.className = 'proxy-status warning';
    }
  } catch (err) {
    dom.proxyTestStatus.textContent = `✕ ${err.message}`;
    dom.proxyTestStatus.className = 'proxy-status error';
  }
}

// ==============================================================================
// Search Handlers
// ==============================================================================

/**
 * Handle Album Search
 */
async function handleAlbumSearch(e) {
  if (e) e.preventDefault();
  const albumName = dom.albumNameInput.value.trim();
  const artistName = dom.albumArtistInput.value.trim();

  if (!albumName && !artistName) return;

  showLoadingState();
  hideError();

  try {
    const candidates = await findAlbums(albumName, artistName);
    if (!candidates || candidates.length === 0) {
      showError(`No albums found matching "${albumName || ''} ${artistName || ''}". Try refining the album title or artist name.`, false);
      return;
    }

    state.albumCandidates = candidates;
    renderAlbumCandidates(candidates);
  } catch (err) {
    console.error("Album search error:", err);
    showError(err.message, !isLocalhost && !API_CONFIG.customWorkerUrl);
  } finally {
    hideLoadingState();
  }
}

/**
 * Render matched album candidates list
 */
function renderAlbumCandidates(candidates) {
  dom.albumCandidatesList.innerHTML = '';

  candidates.forEach((album, idx) => {
    const card = document.createElement('div');
    card.className = 'album-candidate-card';

    const singer = album.singername || 'Unknown Artist';
    const albumName = album.albumname || `Album ${album.albumid}`;
    const songCount = album.songcount || 0;
    const pubDate = (album.publishtime || '').slice(0, 10);

    card.innerHTML = `
      <div class="album-candidate-info">
        <div class="album-candidate-title">
          ${escapeHtml(albumName)}
          ${idx === 0 ? '<span class="badge badge-word-sync">Best Match</span>' : ''}
        </div>
        <div class="album-candidate-artist">${escapeHtml(singer)}</div>
        <div class="album-candidate-meta">
          <span>${songCount} Tracks</span>
          ${pubDate ? `<span>• Released: ${pubDate}</span>` : ''}
          <span>• ID: ${album.albumid}</span>
        </div>
      </div>
      <div>
        <button type="button" class="btn btn-primary btn-sm select-album-btn" data-index="${idx}">
          Select Album →
        </button>
      </div>
    `;

    card.querySelector('.select-album-btn').addEventListener('click', () => {
      loadAlbumDetails(album);
    });

    dom.albumCandidatesList.appendChild(card);
  });

  dom.emptyState.style.display = 'none';
  dom.albumView.style.display = 'none';
  dom.songResultsView.style.display = 'none';
  dom.albumCandidatesView.style.display = 'block';
}

/**
 * Load and display album metadata & tracks
 */
async function loadAlbumDetails(albumData) {
  state.currentAlbum = albumData;
  const albumId = albumData.albumid;
  showLoadingState();

  try {
    const detailed = await getAlbumInfo(albumId);
    const singer = detailed.singername || albumData.singername || "Unknown Artist";
    const albumName = detailed.albumname || albumData.albumname || `Album ${albumId}`;
    const publishTime = (detailed.publishtime || albumData.publishtime || "").slice(0, 10);

    // Update Album View UI
    dom.albumTitle.textContent = albumName;
    dom.albumArtist.textContent = singer;
    dom.albumMetaInfo.textContent = `Release: ${publishTime || 'N/A'} • Kugou ID: ${albumId}`;

    // Fetch tracklist
    const tracks = await getAlbumTracks(albumId);
    state.currentAlbumTracks = tracks;
    state.selectedTrackIndices = new Set(tracks.map((_, i) => i));

    renderTracklist(tracks, singer, albumName);

    // Show album tracklist view
    dom.emptyState.style.display = 'none';
    dom.albumCandidatesView.style.display = 'none';
    dom.songResultsView.style.display = 'none';
    dom.albumView.style.display = 'block';
  } catch (err) {
    showError(`Failed to load album tracks: ${err.message}`, !isLocalhost && !API_CONFIG.customWorkerUrl);
  } finally {
    hideLoadingState();
  }
}

/**
 * Render album tracklist table
 */
function renderTracklist(tracks, defaultArtist, defaultAlbum) {
  dom.trackListTableBody.innerHTML = '';

  if (tracks.length === 0) {
    dom.trackListTableBody.innerHTML = `<tr><td colspan="5" class="empty-table">No tracks found in this album catalog.</td></tr>`;
    updateSelectedTrackCount();
    return;
  }

  dom.selectAllCheckbox.checked = true;

  tracks.forEach((track, index) => {
    const tr = document.createElement('tr');
    const trackNum = tracks.length < 100 ? String(index + 1).padStart(2, '0') : String(index + 1).padStart(3, '0');
    const title = track.filename || `Track ${index + 1}`;
    const durationSec = track.duration || 0;
    const durMin = Math.floor(durationSec / 60);
    const durSec = String(durationSec % 60).padStart(2, '0');
    const durStr = durationSec > 0 ? `${durMin}:${durSec}` : '--:--';

    tr.innerHTML = `
      <td>
        <input type="checkbox" class="track-select-cb" data-index="${index}" checked>
      </td>
      <td class="track-num-cell">${trackNum}</td>
      <td class="track-title-cell">
        <span class="track-title-text">${escapeHtml(title)}</span>
      </td>
      <td class="track-duration-cell">${durStr}</td>
      <td class="track-actions-cell">
        <button type="button" class="btn btn-sm btn-outline preview-track-btn" data-index="${index}" title="Preview Synchronized Lyrics">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          Preview
        </button>
      </td>
    `;

    // Track Checkbox Listener
    const cb = tr.querySelector('.track-select-cb');
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.selectedTrackIndices.add(index);
      } else {
        state.selectedTrackIndices.delete(index);
      }
      updateSelectedTrackCount();
    });

    // Preview Button Listener
    const prevBtn = tr.querySelector('.preview-track-btn');
    prevBtn.addEventListener('click', () => openTrackLyricsPreview(track, defaultArtist, defaultAlbum));

    dom.trackListTableBody.appendChild(tr);
  });

  updateSelectedTrackCount();
}

/**
 * Toggle select all track checkboxes
 */
function handleSelectAllToggle(e) {
  const isChecked = e.target.checked;
  const checkboxes = dom.trackListTableBody.querySelectorAll('.track-select-cb');
  state.selectedTrackIndices.clear();

  checkboxes.forEach((cb, idx) => {
    cb.checked = isChecked;
    if (isChecked) {
      state.selectedTrackIndices.add(idx);
    }
  });

  updateSelectedTrackCount();
}

/**
 * Update selected count label
 */
function updateSelectedTrackCount() {
  const total = state.currentAlbumTracks.length;
  const selected = state.selectedTrackIndices.size;
  dom.selectedCountBadge.textContent = `${selected} / ${total} selected`;
  dom.downloadAlbumZipBtn.disabled = selected === 0;
}

/**
 * Handle Single Song Search
 */
async function handleSongSearch(e) {
  if (e) e.preventDefault();
  const title = dom.songTitleInput.value.trim();
  const artist = dom.songArtistInput.value.trim();

  if (!title && !artist) return;

  showLoadingState();
  hideError();

  try {
    const query = artist ? `${artist} - ${title}` : title;
    const candidates = await findLyricsForTrack(query, null, null, artist);
    if (!candidates || candidates.length === 0) {
      showError(`No lyrics found for "${query}". Try adjusting the song title or artist name.`, false);
      return;
    }

    renderSongResults(candidates, title, artist);
  } catch (err) {
    console.error("Song search error:", err);
    showError(err.message, !isLocalhost && !API_CONFIG.customWorkerUrl);
  } finally {
    hideLoadingState();
  }
}

/**
 * Render single song candidates list
 */
function renderSongResults(candidates, searchTitle, searchArtist) {
  dom.songResultsList.innerHTML = '';

  candidates.slice(0, 15).forEach((cand, idx) => {
    const card = document.createElement('div');
    card.className = 'song-result-card';

    const songName = cand.song || searchTitle || 'Unknown Title';
    const singerName = cand.singer || searchArtist || 'Unknown Artist';
    const hasWordSync = [1, 2].includes(cand.krctype);
    const score = cand.score || 0;

    card.innerHTML = `
      <div class="song-card-info">
        <div class="song-card-title">${escapeHtml(songName)}</div>
        <div class="song-card-artist">${escapeHtml(singerName)}</div>
        <div class="song-card-tags">
          ${hasWordSync ? '<span class="badge badge-word-sync">Word-Synced (KRC)</span>' : '<span class="badge">Line-Synced</span>'}
          <span class="badge badge-score">Match Score: ${score}</span>
        </div>
      </div>
      <div class="song-card-actions">
        <button type="button" class="btn btn-sm btn-outline preview-cand-btn" data-index="${idx}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          Preview
        </button>
        <button type="button" class="btn btn-sm btn-primary download-single-btn" data-index="${idx}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" y2="3"/></svg>
          Download Lyrics
        </button>
      </div>
    `;

    card.querySelector('.preview-cand-btn').addEventListener('click', () => {
      openCandidateLyricsPreview(cand);
    });

    card.querySelector('.download-single-btn').addEventListener('click', () => {
      handleDownloadSingleCandidate(cand);
    });

    dom.songResultsList.appendChild(card);
  });

  dom.emptyState.style.display = 'none';
  dom.albumCandidatesView.style.display = 'none';
  dom.albumView.style.display = 'none';
  dom.songResultsView.style.display = 'block';
}

// ==============================================================================
// Lyric Preview Engine
// ==============================================================================

async function openTrackLyricsPreview(track, defaultArtist, defaultAlbum) {
  const title = track.filename || "Track";
  showLoadingState();

  try {
    const candidates = await findLyricsForTrack(title, track.hash, track.duration, defaultArtist);
    if (!candidates || candidates.length === 0) {
      alert(`No lyrics found on Kugou for track: "${title}"`);
      return;
    }
    const cand = candidates[0];
    await loadAndShowPreviewModal(cand, title, defaultArtist, defaultAlbum);
  } catch (err) {
    alert(`Could not load preview: ${err.message}`);
  } finally {
    hideLoadingState();
  }
}

async function openCandidateLyricsPreview(cand) {
  showLoadingState();
  try {
    await loadAndShowPreviewModal(cand, cand.song, cand.singer, "");
  } catch (err) {
    alert(`Could not load preview: ${err.message}`);
  } finally {
    hideLoadingState();
  }
}

async function loadAndShowPreviewModal(cand, songTitle, artistName, albumName) {
  const krcText = await fetchAndDecryptLyrics(cand.id, cand.accesskey);
  const parsed = parseKrc(krcText);

  state.previewData = {
    cand: cand,
    songTitle: songTitle || cand.song || "Song",
    artistName: artistName || cand.singer || "Artist",
    albumName: albumName || "",
    krcText: krcText,
    parsed: parsed,
    isPlaying: false,
    playbackTimer: null,
    currentTimeMs: 0,
    durationMs: parsed.lines.length > 0 ? parsed.lines[parsed.lines.length - 1].end_ms + 2000 : 60000,
    activeTab: 'karaoke'
  };

  dom.previewSongTitle.textContent = state.previewData.songTitle;
  dom.previewSongArtist.textContent = state.previewData.artistName;
  dom.previewScrubber.max = state.previewData.durationMs;
  dom.previewScrubber.value = 0;

  renderPreviewTabNavigation();
  showPreviewTab('karaoke');
  dom.previewModal.showModal();
}

function renderPreviewTabNavigation() {
  const tabs = [
    { id: 'karaoke', label: 'Karaoke View' },
    { id: 'ttml', label: 'TTML' },
    { id: 'krc', label: 'KRC' },
    { id: 'enhanced-lrc', label: 'Enhanced LRC' },
    { id: 'standard-lrc', label: 'Standard LRC' },
    { id: 'srt', label: 'SRT' },
    { id: 'json', label: 'JSON' }
  ];

  dom.previewTabsContainer.innerHTML = '';
  tabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `preview-tab-btn ${state.previewData.activeTab === tab.id ? 'active' : ''}`;
    btn.textContent = tab.label;
    btn.addEventListener('click', () => showPreviewTab(tab.id));
    dom.previewTabsContainer.appendChild(btn);
  });
}

function showPreviewTab(tabId) {
  state.previewData.activeTab = tabId;
  renderPreviewTabNavigation();

  if (tabId === 'karaoke') {
    dom.previewKaraokePane.style.display = 'block';
    dom.previewTextPane.style.display = 'none';
    renderKaraokeView();
    updatePreviewPlaybackView();
  } else {
    dom.previewKaraokePane.style.display = 'none';
    dom.previewTextPane.style.display = 'block';
    let textContent = '';
    const p = state.previewData.parsed;
    const a = state.previewData.artistName;
    const t = state.previewData.songTitle;
    const al = state.previewData.albumName;

    switch (tabId) {
      case 'ttml': textContent = convertToTtml(p, a, t, al); break;
      case 'krc': textContent = state.previewData.krcText; break;
      case 'enhanced-lrc': textContent = convertToEnhancedLrc(p); break;
      case 'standard-lrc': textContent = convertToStandardLrc(p); break;
      case 'srt': textContent = convertToSrt(p); break;
      case 'json': textContent = convertToJson(p); break;
    }
    dom.previewTextContent.value = textContent;
  }
}

function renderKaraokeView() {
  const container = dom.previewKaraokePane;
  container.innerHTML = '';
  const lines = state.previewData.parsed?.lines || [];

  if (lines.length === 0) {
    container.innerHTML = '<div class="empty-karaoke">No timing lines available for this song.</div>';
    return;
  }

  lines.forEach((line, lineIdx) => {
    const p = document.createElement('div');
    p.className = 'karaoke-line';
    p.id = `k-line-${lineIdx}`;
    p.dataset.startMs = line.start_ms;
    p.dataset.endMs = line.end_ms;

    line.words.forEach((w, wIdx) => {
      const span = document.createElement('span');
      span.className = 'karaoke-word';
      span.id = `k-word-${lineIdx}-${wIdx}`;
      span.dataset.startMs = w.start_ms;
      span.dataset.endMs = w.end_ms;
      span.textContent = w.text;
      p.appendChild(span);
    });

    container.appendChild(p);
  });
}

function updatePreviewPlaybackView() {
  const curMs = state.previewData.currentTimeMs;
  dom.previewScrubber.value = curMs;
  dom.previewTimeLabel.textContent = `${formatMsToMinutes(curMs)} / ${formatMsToMinutes(state.previewData.durationMs)}`;

  if (state.previewData.activeTab !== 'karaoke') return;

  const lines = state.previewData.parsed?.lines || [];
  let activeLineElem = null;

  lines.forEach((line, lineIdx) => {
    const lineElem = document.getElementById(`k-line-${lineIdx}`);
    if (!lineElem) return;

    const isLineActive = curMs >= line.start_ms && curMs <= line.end_ms;
    const isLinePassed = curMs > line.end_ms;

    lineElem.classList.toggle('active', isLineActive);
    lineElem.classList.toggle('passed', isLinePassed);

    if (isLineActive) activeLineElem = lineElem;

    line.words.forEach((w, wIdx) => {
      const wordElem = document.getElementById(`k-word-${lineIdx}-${wIdx}`);
      if (!wordElem) return;

      const isWordActive = curMs >= w.start_ms && curMs <= w.end_ms;
      const isWordPassed = curMs > w.end_ms;

      wordElem.classList.toggle('active', isWordActive);
      wordElem.classList.toggle('passed', isWordPassed);
    });
  });

  if (activeLineElem && state.previewData.isPlaying) {
    activeLineElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function togglePreviewPlayback() {
  if (state.previewData.isPlaying) {
    stopPreviewPlayback();
  } else {
    startPreviewPlayback();
  }
}

function startPreviewPlayback() {
  state.previewData.isPlaying = true;
  dom.previewPlayBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
    Pause
  `;

  const intervalMs = 50;
  state.previewData.playbackTimer = setInterval(() => {
    state.previewData.currentTimeMs += intervalMs;
    if (state.previewData.currentTimeMs >= state.previewData.durationMs) {
      state.previewData.currentTimeMs = 0;
      stopPreviewPlayback();
    }
    updatePreviewPlaybackView();
  }, intervalMs);
}

function stopPreviewPlayback() {
  state.previewData.isPlaying = false;
  if (state.previewData.playbackTimer) {
    clearInterval(state.previewData.playbackTimer);
    state.previewData.playbackTimer = null;
  }
  if (dom.previewPlayBtn) {
    dom.previewPlayBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Play Preview
    `;
  }
}

function handleCopyPreviewText() {
  const tab = state.previewData.activeTab;
  let textToCopy = '';
  const p = state.previewData.parsed;
  const a = state.previewData.artistName;
  const t = state.previewData.songTitle;
  const al = state.previewData.albumName;

  switch (tab) {
    case 'ttml': textToCopy = convertToTtml(p, a, t, al); break;
    case 'krc': textToCopy = state.previewData.krcText; break;
    case 'enhanced-lrc': textToCopy = convertToEnhancedLrc(p); break;
    case 'standard-lrc': textToCopy = convertToStandardLrc(p); break;
    case 'srt': textToCopy = convertToSrt(p); break;
    case 'json': textToCopy = convertToJson(p); break;
    default: textToCopy = convertToTtml(p, a, t, al); break;
  }

  navigator.clipboard.writeText(textToCopy).then(() => {
    const orig = dom.previewCopyBtn.textContent;
    dom.previewCopyBtn.textContent = '✓ Copied!';
    setTimeout(() => { dom.previewCopyBtn.textContent = orig; }, 1800);
  });
}

function handleDownloadPreviewedTrack() {
  const p = state.previewData.parsed;
  const artist = state.previewData.artistName;
  const title = state.previewData.songTitle;
  const album = state.previewData.albumName;
  const baseName = formatFilename(state.options.namingTemplate, {
    trackNum: "01",
    title,
    artist,
    album
  });

  const tab = state.previewData.activeTab;
  let content = '';
  let ext = 'ttml';

  if (tab === 'krc') {
    content = state.previewData.krcText;
    ext = 'krc';
  } else if (tab === 'enhanced-lrc' || tab === 'standard-lrc') {
    content = tab === 'enhanced-lrc' ? convertToEnhancedLrc(p) : convertToStandardLrc(p);
    ext = 'lrc';
  } else if (tab === 'srt') {
    content = convertToSrt(p);
    ext = 'srt';
  } else if (tab === 'json') {
    content = convertToJson(p);
    ext = 'json';
  } else {
    content = convertToTtml(p, artist, title, state.previewData.albumName);
    ext = 'ttml';
  }

  triggerBrowserDownload(`${baseName}.${ext}`, content, 'text/plain;charset=utf-8');
}

// ==============================================================================
// Batch Downloading & ZIP Packaging (Lyrics Only - Zero Cover Art)
// ==============================================================================

/**
 * Download single song candidate
 */
async function handleDownloadSingleCandidate(cand) {
  showLoadingState();
  try {
    const krcText = await fetchAndDecryptLyrics(cand.id, cand.accesskey);
    const parsed = parseKrc(krcText);
    const artist = cand.singer || "Unknown Artist";
    const song = cand.song || "Unknown Song";
    const baseName = formatFilename(state.options.namingTemplate, {
      trackNum: "01",
      title: song,
      artist: artist,
      album: ""
    });

    const activeFormats = getActiveFormats();
    if (activeFormats.length === 1) {
      const fmt = activeFormats[0];
      const { content, ext } = getFormattedLyric(fmt, parsed, krcText, artist, song, "");
      triggerBrowserDownload(`${baseName}.${ext}`, content, 'text/plain;charset=utf-8');
    } else {
      const zip = new JSZip();
      activeFormats.forEach(fmt => {
        const { content, ext } = getFormattedLyric(fmt, parsed, krcText, artist, song, "");
        zip.file(`${baseName}.${ext}`, content);
      });
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      triggerBrowserDownload(`${baseName}_Lyrics.zip`, zipBlob, 'application/zip');
    }
  } catch (err) {
    alert(`Download failed: ${err.message}`);
  } finally {
    hideLoadingState();
  }
}

/**
 * Handle Cancel / Close on batch progress modal
 */
function handleCancelOrCloseDownload() {
  if (state.isDownloading) {
    state.isDownloading = false;
    if (state.downloadAbortController) {
      state.downloadAbortController.abort();
      state.downloadAbortController = null;
    }
    logProgressItem('Download cancelled by user.', 'error');
    dom.progressCurrentStatus.textContent = 'Download cancelled.';
    dom.progressCancelBtn.textContent = 'Close';
  } else {
    if (dom.progressModal && dom.progressModal.open) {
      dom.progressModal.close();
    }
  }
}

/**
 * Download selected album tracks packaged into a ZIP archive (LYRICS ONLY)
 */
async function handleDownloadAlbumZip() {
  const selectedIndices = Array.from(state.selectedTrackIndices).sort((a, b) => a - b);
  if (selectedIndices.length === 0) {
    alert("Please select at least one track to download.");
    return;
  }

  const activeFormats = getActiveFormats();
  if (activeFormats.length === 0) {
    alert("Please select at least one lyric format (.ttml, .krc, etc.) from the format options.");
    return;
  }

  const album = state.currentAlbum;
  const albumTitle = sanitizeFilename(album.albumname || "Album");
  const singer = sanitizeFilename(album.singername || "Artist");
  const folderName = `${singer} - ${albumTitle}`;

  // Reset Progress Modal UI
  dom.progressTitle.textContent = `Downloading ${selectedIndices.length} Lyric Tracks...`;
  dom.progressCurrentStatus.textContent = 'Initializing ZIP archive...';
  dom.progressPercentage.textContent = '0%';
  dom.progressBar.style.width = '0%';
  dom.progressLogList.innerHTML = '';
  dom.progressCancelBtn.textContent = 'Cancel Download';
  dom.progressModal.showModal();

  state.isDownloading = true;
  state.downloadAbortController = new AbortController();
  const zip = new JSZip();
  let completedCount = 0;
  let successCount = 0;
  let failedCount = 0;

  const total = selectedIndices.length;

  for (let i = 0; i < total; i++) {
    if (!state.isDownloading) {
      break;
    }

    const trackIndex = selectedIndices[i];
    const track = state.currentAlbumTracks[trackIndex];
    const trackTitle = track.filename || `Track ${trackIndex + 1}`;
    const cleanTitle = sanitizeFilename(trackTitle);

    const trackNum = state.currentAlbumTracks.length < 100
      ? String(trackIndex + 1).padStart(2, '0')
      : String(trackIndex + 1).padStart(3, '0');

    // Use custom naming template
    const fileBase = formatFilename(state.options.namingTemplate, {
      trackNum: trackNum,
      title: cleanTitle,
      artist: album.singername || singer,
      album: album.albumname || albumTitle
    });

    dom.progressCurrentStatus.textContent = `[${i + 1}/${total}] Fetching lyrics: ${cleanTitle}`;

    try {
      const candidates = await findLyricsForTrack(trackTitle, track.hash, track.duration, album.singername);
      if (!candidates || candidates.length === 0) {
        logProgressItem(`✕ [${i + 1}/${total}] No lyrics found: ${cleanTitle}`, 'warning');
        failedCount++;
      } else {
        const chosen = candidates[0];
        const krcText = await fetchAndDecryptLyrics(chosen.id, chosen.accesskey);
        const parsed = parseKrc(krcText);

        activeFormats.forEach(fmt => {
          const { content, ext } = getFormattedLyric(fmt, parsed, krcText, album.singername, cleanTitle, album.albumname);
          zip.file(`${fileBase}.${ext}`, content);
        });

        logProgressItem(`✓ [${i + 1}/${total}] Saved lyrics: ${cleanTitle}`, 'success');
        successCount++;
      }
    } catch (err) {
      if (!state.isDownloading) break;
      logProgressItem(`✕ [${i + 1}/${total}] Error (${cleanTitle}): ${err.message}`, 'error');
      failedCount++;
    }

    completedCount++;
    const percent = Math.round((completedCount / total) * 100);
    dom.progressBar.style.width = `${percent}%`;
    dom.progressPercentage.textContent = `${percent}%`;
  }

  if (state.isDownloading) {
    if (successCount > 0) {
      dom.progressCurrentStatus.textContent = 'Generating final ZIP bundle...';
      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        dom.progressPercentage.textContent = `${Math.round(metadata.percent)}%`;
      });

      triggerBrowserDownload(`${folderName}_Lyrics.zip`, zipBlob, 'application/zip');
      dom.progressCurrentStatus.textContent = `Complete! Downloaded lyrics for ${successCount} tracks (${failedCount} failed).`;
    } else {
      dom.progressCurrentStatus.textContent = `Done. No lyrics could be retrieved.`;
    }
  }

  state.isDownloading = false;
  state.downloadAbortController = null;
  dom.progressCancelBtn.textContent = 'Close';
}

function getFormattedLyric(fmt, parsed, rawKrc, artist, title, album) {
  switch (fmt) {
    case 'krc':
      return { content: rawKrc, ext: 'krc' };
    case 'ttml':
      return { content: convertToTtml(parsed, artist, title, album), ext: 'ttml' };
    case 'enhanced-lrc':
      return { content: convertToEnhancedLrc(parsed), ext: 'lrc' };
    case 'standard-lrc':
      return { content: convertToStandardLrc(parsed), ext: 'lrc' };
    case 'srt':
      return { content: convertToSrt(parsed), ext: 'srt' };
    case 'json':
      return { content: convertToJson(parsed), ext: 'json' };
    default:
      return { content: convertToTtml(parsed, artist, title, album), ext: 'ttml' };
  }
}

function getActiveFormats() {
  return Object.keys(state.selectedFormats).filter(k => state.selectedFormats[k]);
}

function logProgressItem(msg, type = 'info') {
  const item = document.createElement('div');
  item.className = `progress-log-item log-${type}`;
  item.textContent = msg;
  dom.progressLogList.appendChild(item);
  dom.progressLogList.scrollTop = dom.progressLogList.scrollHeight;
}

// ==============================================================================
// Utilities
// ==============================================================================

function triggerBrowserDownload(fileName, contentOrBlob, mimeType) {
  const blob = contentOrBlob instanceof Blob ? contentOrBlob : new Blob([contentOrBlob], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

function formatMsToMinutes(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function showLoadingState() {
  if (dom.searchSpinner) dom.searchSpinner.style.display = 'inline-block';
}

function hideLoadingState() {
  if (dom.searchSpinner) dom.searchSpinner.style.display = 'none';
}

function showError(msg, showProxyBtn = false) {
  if (dom.errorMessage) dom.errorMessage.textContent = msg;
  if (dom.errorProxyBtn) dom.errorProxyBtn.style.display = showProxyBtn ? 'inline-block' : 'none';
  if (dom.errorState) dom.errorState.style.display = 'block';
}

function hideError() {
  if (dom.errorState) dom.errorState.style.display = 'none';
  if (dom.errorProxyBtn) dom.errorProxyBtn.style.display = 'none';
}
