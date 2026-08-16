/**
 * Kugou API Client for Browser & GitHub Pages
 * Handles proxied HTTP requests, query normalization, relevance scoring, and track retrieval.
 */

// Detect if running on localhost / local server
const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname === '' ||
  window.location.protocol === 'file:'
);

const API_CONFIG = {
  proxies: [
    {
      id: "custom",
      name: "Cloudflare Worker Proxy (Required for GitHub Pages)",
      formatUrl: (url, customBase) => {
        const cleanBase = (customBase || "").trim().replace(/\/+$/, "");
        return `${cleanBase}/?url=${encodeURIComponent(url)}`;
      }
    },
    {
      id: "local",
      name: "Local Python Server (/api/proxy for localhost)",
      formatUrl: (url) => `/api/proxy?url=${encodeURIComponent(url)}`
    },
    {
      id: "direct",
      name: "Direct (Requires Browser CORS Extension)",
      formatUrl: (url) => url
    }
  ],
  selectedProxy: isLocalhost ? "local" : "custom",
  customWorkerUrl: ""
};

/**
 * Build URL based on active proxy setting
 */
function buildProxiedUrl(targetUrl) {
  const proxy = API_CONFIG.proxies.find(p => p.id === API_CONFIG.selectedProxy) || API_CONFIG.proxies[0];

  if (proxy.id === "custom") {
    if (!API_CONFIG.customWorkerUrl) {
      if (isLocalhost) {
        return `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
      }
      throw new Error("Cloudflare Worker URL is required on GitHub Pages. Please click 'Settings & Proxy' to configure your worker URL.");
    }
    return proxy.formatUrl(targetUrl, API_CONFIG.customWorkerUrl);
  }

  if (proxy.id === "local") {
    if (!isLocalhost && !API_CONFIG.customWorkerUrl) {
      throw new Error("Local server (/api/proxy) is only available on localhost. For GitHub Pages, please configure a Cloudflare Worker in Settings.");
    }
    return proxy.formatUrl(targetUrl);
  }

  return proxy.formatUrl(targetUrl);
}

/**
 * Fetch JSON with timeout & proxy handling
 */
async function fetchKugouJson(targetUrl, timeoutMs = 12000) {
  const proxiedUrl = buildProxiedUrl(targetUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(proxiedUrl, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json, text/plain, */*"
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (parseErr) {
      throw new Error("Invalid JSON response received from API/Proxy. Check worker URL.");
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s. Check Proxy & Worker URL in Settings.`);
    }
    throw err;
  }
}

/**
 * Sanitize filename for safe OS saving
 */
function sanitizeFilename(name) {
  if (!name) return "Unknown";
  let s = String(name).replace(/[、/]/g, " ");
  s = s.replace(/[\\*?:"<>|]/g, "");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Score album candidate relevance based on Album Name & Artist Name
 */
function scoreAlbumCandidate(candidate, albumNameQuery, artistNameQuery) {
  const singer = (candidate.singername || "").toLowerCase();
  const album = (candidate.albumname || "").toLowerCase();
  const combined = `${singer} ${album}`;
  
  const aLower = (albumNameQuery || "").toLowerCase().trim();
  const artLower = (artistNameQuery || "").toLowerCase().trim();

  let score = 0;

  // Penalize tribute / cover / karaoke / instrumental unless requested
  const unwanted = ["tribute", "originally performed by", "karaoke", "instrumental", "backing track", "performs", "tribute band"];
  for (const ut of unwanted) {
    if (combined.includes(ut) && !aLower.includes(ut) && !artLower.includes(ut)) {
      score -= 300;
    }
  }

  // Exact album name match
  if (album === aLower) {
    score += 150;
  } else if (album.includes(aLower) && aLower.length > 1) {
    score += 80;
  }

  // Exact artist name match
  if (artLower) {
    if (singer === artLower) {
      score += 120;
    } else if (singer.includes(artLower)) {
      score += 60;
    }
  }

  // Track count bonus
  const songCount = parseInt(candidate.songcount || 0, 10);
  if (songCount > 0) {
    score += Math.min(songCount * 2, 40);
  }

  return score;
}

/**
 * Score single song candidate
 */
function scoreSongCandidate(candidate, songTitle, artistName) {
  const singer = (candidate.singer || "").toLowerCase();
  const song = (candidate.song || "").toLowerCase();
  const combined = `${singer} ${song}`;

  const tLower = (songTitle || "").toLowerCase().trim();
  const aLower = (artistName || "").toLowerCase().trim();

  let score = candidate.score || 0;

  const unwanted = ["tribute", "originally performed by", "karaoke", "instrumental", "backing track"];
  for (const u of unwanted) {
    if (combined.includes(u) && !tLower.includes(u) && !aLower.includes(u)) {
      score -= 200;
    }
  }

  if (song === tLower) {
    score += 100;
  } else if (song.includes(tLower) && tLower.length > 1) {
    score += 50;
  }

  if (aLower) {
    if (singer === aLower) {
      score += 80;
    } else if (singer.includes(aLower)) {
      score += 40;
    }
  }

  // Prefer word-synced KRC
  if ([1, 2].includes(candidate.krctype)) {
    score += 30;
  }

  return score;
}

// ==============================================================================
// Kugou API Endpoints
// ==============================================================================

/**
 * Search Kugou mobile catalog for albums by keyword
 */
async function searchAlbumApi(keyword, page = 1, pagesize = 15) {
  if (!keyword || !keyword.trim()) return [];
  const url = `http://mobilecdn.kugou.com/api/v3/search/album?format=json&keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${pagesize}`;
  try {
    const data = await fetchKugouJson(url);
    return data?.data?.info || [];
  } catch (err) {
    console.warn("searchAlbumApi error:", err);
    throw err;
  }
}

/**
 * Find albums given separate Album Name and Artist Name inputs
 */
async function findAlbums(albumName, artistName = "") {
  const aClean = (albumName || "").trim();
  const artClean = (artistName || "").trim();

  if (!aClean && !artClean) return [];

  // Check direct album ID
  if (/^\d+$/.test(aClean)) {
    const albumId = parseInt(aClean, 10);
    const info = await getAlbumInfo(albumId);
    if (info && Object.keys(info).length > 0) {
      return [{
        albumid: albumId,
        singername: info.singername || "Unknown Artist",
        albumname: info.albumname || `Album ${albumId}`,
        songcount: info.songcount || 0,
        publishtime: info.publishtime || ""
      }];
    }
    return [{
      albumid: albumId,
      singername: artClean || "Unknown Artist",
      albumname: `Album ${albumId}`,
      songcount: 0
    }];
  }

  const queries = [];
  if (artClean && aClean) {
    queries.push(`${artClean} ${aClean}`);
    queries.push(`${aClean} ${artClean}`);
    queries.push(aClean);
  } else if (aClean) {
    queries.push(aClean);
  } else if (artClean) {
    queries.push(artClean);
  }

  const allCandidates = [];
  const seenIds = new Set();

  for (const q of queries) {
    const results = await searchAlbumApi(q, 1, 12);
    for (const r of results) {
      const aid = r.albumid;
      if (aid && !seenIds.has(aid)) {
        seenIds.add(aid);
        allCandidates.push(r);
      }
    }
    if (allCandidates.length >= 12) break;
  }

  allCandidates.sort((a, b) => scoreAlbumCandidate(b, aClean, artClean) - scoreAlbumCandidate(a, aClean, artClean));
  return allCandidates;
}

/**
 * Retrieve detailed metadata for an album
 */
async function getAlbumInfo(albumId) {
  const url = `http://mobilecdn.kugou.com/api/v3/album/info?format=json&albumid=${albumId}`;
  try {
    const data = await fetchKugouJson(url);
    if (data?.status === 1) {
      return data.data || {};
    }
  } catch (err) {
    console.warn("getAlbumInfo error:", err);
  }
  return {};
}

/**
 * Retrieve complete tracklist for an album with automatic pagination
 */
async function getAlbumTracks(albumId) {
  const tracks = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const url = `http://mobilecdn.kugou.com/api/v3/album/song?format=json&albumid=${albumId}&page=${page}&pagesize=${pageSize}`;
    try {
      const data = await fetchKugouJson(url);
      if (data?.status !== 1) break;
      const infoList = data?.data?.info || [];
      if (infoList.length === 0) break;
      tracks.push(...infoList);

      const total = data?.data?.total || tracks.length;
      if (tracks.length >= total || infoList.length < pageSize) {
        break;
      }
      page++;
    } catch (err) {
      console.warn(`getAlbumTracks page ${page} error:`, err);
      break;
    }
  }

  return tracks;
}

/**
 * Search lyrics candidates by keyword or hash
 */
async function searchLyricsApi({ keyword, songHash, durationMs }) {
  const params = new URLSearchParams({ ver: "1", man: "yes", client: "pc" });
  if (keyword) params.append("keyword", keyword);
  if (songHash) params.append("hash", songHash);
  if (durationMs) params.append("duration", String(durationMs));

  const url = `http://lyrics.kugou.com/search?${params.toString()}`;
  try {
    const data = await fetchKugouJson(url);
    if (data?.status === 200) {
      return data.candidates || [];
    }
  } catch (err) {
    console.warn("searchLyricsApi error:", err);
    throw err;
  }
  return [];
}

/**
 * Search mobile catalog songs
 */
async function searchMobileSongs(keyword) {
  const url = `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(keyword)}&page=1&pagesize=10&showtype=1`;
  try {
    const data = await fetchKugouJson(url);
    return data?.data?.info || [];
  } catch (err) {
    console.warn("searchMobileSongs error:", err);
    return [];
  }
}

/**
 * Find best word-synced lyric candidate for a track
 */
async function findLyricsForTrack(trackTitle, songHash = null, durationSec = null, artistName = "") {
  const durationMs = durationSec ? Math.round(durationSec * 1000) : null;

  // Step 1: Query by Hash
  if (songHash) {
    const cands = await searchLyricsApi({ songHash, durationMs });
    if (cands && cands.length > 0) {
      cands.sort((a, b) => {
        const aKrc = [1, 2].includes(a.krctype) ? 1 : 0;
        const bKrc = [1, 2].includes(b.krctype) ? 1 : 0;
        if (aKrc !== bKrc) return bKrc - aKrc;
        return (b.score || 0) - (a.score || 0);
      });
      return cands;
    }
  }

  // Step 2: Query by Title
  const cands = await searchLyricsApi({ keyword: trackTitle, durationMs });
  if (cands && cands.length > 0) {
    cands.sort((a, b) => scoreSongCandidate(b, trackTitle, artistName) - scoreSongCandidate(a, trackTitle, artistName));
    return cands;
  }

  // Step 3: Fallback through Mobile CDN Song Search
  const songs = await searchMobileSongs(trackTitle);
  for (const s of songs.slice(0, 4)) {
    const fHash = s.hash;
    if (fHash) {
      try {
        const fallbackCands = await searchLyricsApi({ songHash: fHash });
        if (fallbackCands && fallbackCands.length > 0) {
          fallbackCands.sort((a, b) => {
            const aKrc = [1, 2].includes(a.krctype) ? 1 : 0;
            const bKrc = [1, 2].includes(b.krctype) ? 1 : 0;
            if (aKrc !== bKrc) return bKrc - aKrc;
            return (b.score || 0) - (a.score || 0);
          });
          return fallbackCands;
        }
      } catch (e) {
        // continue
      }
    }
  }

  return [];
}

/**
 * Download base64 KRC payload from Kugou
 */
async function downloadLyricPayload(lyricId, accessKey) {
  const params = new URLSearchParams({
    ver: "1",
    client: "pc",
    id: lyricId,
    accesskey: accessKey,
    fmt: "krc",
    charset: "utf8"
  });

  const url = `http://lyrics.kugou.com/download?${params.toString()}`;
  const data = await fetchKugouJson(url);

  if (data?.status !== 200) {
    throw new Error(data?.errmsg || `Lyric download failed with status ${data?.status}`);
  }

  return data.content || "";
}

/**
 * Download and fully decrypt KRC text for a lyric candidate
 */
async function fetchAndDecryptLyrics(lyricId, accessKey) {
  const base64Content = await downloadLyricPayload(lyricId, accessKey);
  return decryptKrcBase64(base64Content);
}

// Export for module/browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    API_CONFIG,
    buildProxiedUrl,
    fetchKugouJson,
    sanitizeFilename,
    scoreAlbumCandidate,
    scoreSongCandidate,
    findAlbums,
    getAlbumInfo,
    getAlbumTracks,
    searchLyricsApi,
    searchMobileSongs,
    findLyricsForTrack,
    downloadLyricPayload,
    fetchAndDecryptLyrics
  };
}
