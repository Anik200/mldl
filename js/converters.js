/**
 * Kugou Lyrics Format Converters
 * Converts parsed KRC objects into TTML, Enhanced LRC, Standard LRC, SRT, and JSON formats.
 */

/**
 * Escape XML special characters for element body text (&, <, > only)
 * Does NOT replace apostrophes with &apos; to prevent "Her&apos;s" in lyric players.
 */
function escapeXml(unsafe) {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape XML attribute values
 */
function escapeXmlAttr(unsafe) {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Format milliseconds to TTML timestamp (hh:mm:ss.mmm)
 * @param {number} ms 
 * @returns {string}
 */
function formatMsToTtmlTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Format milliseconds to standard LRC timestamp [mm:ss.xx]
 * @param {number} ms 
 * @returns {string}
 */
function formatMsToLrcTag(ms) {
  const totalSeconds = ms / 1000.0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2);
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(5, '0')}]`;
}

/**
 * Format milliseconds to word timestamp <mm:ss.xx>
 * @param {number} ms 
 * @returns {string}
 */
function formatMsToWordTag(ms) {
  const totalSeconds = ms / 1000.0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2);
  return `<${String(minutes).padStart(2, '0')}:${String(seconds).padStart(5, '0')}>`;
}

/**
 * Format milliseconds to SRT timestamp (hh:mm:ss,mmm)
 * @param {number} ms 
 * @returns {string}
 */
function formatMsToSrtTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/**
 * Convert parsed KRC object to Apple Music / W3C TTML word-synced format
 */
function convertToTtml(parsedData, defaultArtist = "", defaultTitle = "", defaultAlbum = "", language = "en") {
  const meta = parsedData.meta || {};
  const title = escapeXml(meta.ti || defaultTitle || "Unknown Title");
  const artist = escapeXml(meta.ar || defaultArtist || "Unknown Artist");
  const album = escapeXml(meta.al || defaultAlbum || "");

  const linesXml = [];
  const lines = parsedData.lines || [];

  for (const line of lines) {
    const pBegin = formatMsToTtmlTime(line.start_ms);
    const pEnd = formatMsToTtmlTime(line.end_ms);

    const spans = [];
    for (const word of (line.words || [])) {
      const wBegin = formatMsToTtmlTime(word.start_ms);
      const wEnd = formatMsToTtmlTime(word.end_ms);
      const wClean = escapeXml(word.text);
      spans.push(`<span begin="${wBegin}" end="${wEnd}">${wClean}</span>`);
    }

    linesXml.push(`      <p begin="${pBegin}" end="${pEnd}">${spans.join('')}</p>`);
  }

  const copyrightTag = album ? `\n      <ttm:copyright>${album}</ttm:copyright>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"
    xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xmlns:itunes="http://music.apple.com/metadata"
    itunes:timing="Word"
    xml:lang="${escapeXmlAttr(language)}">
  <head>
    <metadata>
      <ttm:title>${title}</ttm:title>
      <ttm:agent type="person">${artist}</ttm:agent>${copyrightTag}
    </metadata>
  </head>
  <body>
    <div>
${linesXml.join('\n')}
    </div>
  </body>
</tt>`;
}

/**
 * Convert parsed KRC object to Enhanced LRC format (with word-level timestamps)
 */
function convertToEnhancedLrc(parsedData) {
  const out = [];
  const meta = parsedData.meta || {};
  for (const k of ["ti", "ar", "al", "by", "offset"]) {
    if (meta[k]) {
      out.push(`[${k}:${meta[k]}]`);
    }
  }

  for (const line of (parsedData.lines || [])) {
    const lineTag = formatMsToLrcTag(line.start_ms);
    const wordParts = [];
    for (const w of (line.words || [])) {
      const wordTag = formatMsToWordTag(w.start_ms);
      wordParts.push(`${wordTag}${w.text}`);
    }
    out.push(`${lineTag}${wordParts.join('')}`);
  }

  return out.join('\n');
}

/**
 * Convert parsed KRC object to Standard Line-Synced LRC format
 */
function convertToStandardLrc(parsedData) {
  const out = [];
  const meta = parsedData.meta || {};
  for (const k of ["ti", "ar", "al", "by", "offset"]) {
    if (meta[k]) {
      out.push(`[${k}:${meta[k]}]`);
    }
  }

  for (const line of (parsedData.lines || [])) {
    const lineTag = formatMsToLrcTag(line.start_ms);
    out.push(`${lineTag}${line.text}`);
  }

  return out.join('\n');
}

/**
 * Convert parsed KRC object to SRT subtitle format
 */
function convertToSrt(parsedData) {
  const out = [];
  const lines = parsedData.lines || [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const startSrt = formatMsToSrtTime(line.start_ms);
    const endSrt = formatMsToSrtTime(line.end_ms);
    out.push(`${idx + 1}\n${startSrt} --> ${endSrt}\n${line.text}\n`);
  }
  return out.join('\n');
}

/**
 * Convert parsed KRC object to formatted JSON
 */
function convertToJson(parsedData) {
  return JSON.stringify(parsedData, null, 2);
}

// Export for module/browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeXml,
    escapeXmlAttr,
    formatMsToTtmlTime,
    formatMsToLrcTag,
    formatMsToWordTag,
    formatMsToSrtTime,
    convertToTtml,
    convertToEnhancedLrc,
    convertToStandardLrc,
    convertToSrt,
    convertToJson
  };
}
