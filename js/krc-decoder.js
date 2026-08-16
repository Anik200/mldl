/**
 * Kugou KRC Decryption & Parsing Engine
 * Port of Python Kugou Album Downloader decryption logic.
 */

// 16-byte XOR key for Kugou KRC decryption
const KRC_XOR_KEY = new Uint8Array([
  0x40, 0x47, 0x61, 0x77, 0x5E, 0x32, 0x74, 0x47,
  0x51, 0x36, 0x31, 0x2D, 0xCE, 0xD2, 0x6E, 0x69
]);

/**
 * Decode a base64 string to Uint8Array safely
 */
function base64ToUint8Array(base64) {
  const clean = base64.replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(clean, 'base64'));
  }
  const binaryString = atob(clean);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decrypt raw KRC bytes using Kugou XOR Key + Zlib Inflate
 * @param {Uint8Array} rawBytes 
 * @returns {string} Decrypted UTF-8 KRC string
 */
function decryptKrcBytes(rawBytes) {
  let payload = rawBytes;
  
  // Check for 'krc1' magic prefix (0x6B, 0x72, 0x63, 0x31)
  if (
    rawBytes.length >= 4 &&
    rawBytes[0] === 0x6B &&
    rawBytes[1] === 0x72 &&
    rawBytes[2] === 0x63 &&
    rawBytes[3] === 0x31
  ) {
    payload = rawBytes.subarray(4);
  }

  // XOR Decryption
  const decrypted = new Uint8Array(payload.length);
  const keyLen = KRC_XOR_KEY.length;
  for (let i = 0; i < payload.length; i++) {
    decrypted[i] = payload[i] ^ KRC_XOR_KEY[i % keyLen];
  }

  // Zlib inflate decompression using pako
  if (typeof pako !== 'undefined' && pako.inflate) {
    const inflated = pako.inflate(decrypted);
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(inflated);
  } else {
    throw new Error("Pako zlib decompression library is required for KRC decompression.");
  }
}

/**
 * Unescape HTML entities thoroughly
 */
function unescapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * Decrypt base64-encoded KRC payload from Kugou API & unescape entities
 * @param {string} base64Content 
 * @returns {string} Decrypted KRC text
 */
function decryptKrcBase64(base64Content) {
  const rawBytes = base64ToUint8Array(base64Content);
  const decrypted = decryptKrcBytes(rawBytes);
  return unescapeHtml(decrypted);
}

/**
 * Parse decrypted KRC text into structured timing data
 * @param {string} krcText 
 * @returns {{ meta: Object, lines: Array }}
 */
function parseKrc(krcText) {
  const meta = {};
  const lines = [];

  const rawLines = krcText.split(/\r?\n/);
  for (let rawLine of rawLines) {
    rawLine = rawLine.trim();
    if (!rawLine) continue;

    // Metadata pattern: [key:value]
    const metaMatch = rawLine.match(/^\[([a-zA-Z_]+):(.*)\]$/);
    if (metaMatch) {
      meta[metaMatch[1]] = unescapeHtml(metaMatch[2].trim());
      continue;
    }

    // Line timing pattern: [start_ms,duration_ms]rest
    const lineMatch = rawLine.match(/^\[(\d+),(\d+)\](.*)$/);
    if (lineMatch) {
      const startMs = parseInt(lineMatch[1], 10);
      const durationMs = parseInt(lineMatch[2], 10);
      const rest = lineMatch[3];

      // Word timing pattern: <offset_ms,duration_ms,0>word_text
      const wordRegex = /<(\d+),(\d+),\d+>([^<]*)/g;
      const words = [];
      let match;

      while ((match = wordRegex.exec(rest)) !== null) {
        const offsetMs = parseInt(match[1], 10);
        const wordDurMs = parseInt(match[2], 10);
        const text = unescapeHtml(match[3]);

        words.push({
          text: text,
          offset_ms: offsetMs,
          duration_ms: wordDurMs,
          start_ms: startMs + offsetMs,
          end_ms: startMs + offsetMs + wordDurMs
        });
      }

      lines.push({
        start_ms: startMs,
        duration_ms: durationMs,
        end_ms: startMs + durationMs,
        text: words.map(w => w.text).join(''),
        words: words
      });
    }
  }

  return { meta, lines };
}

// Export for module/browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    KRC_XOR_KEY,
    base64ToUint8Array,
    decryptKrcBytes,
    decryptKrcBase64,
    parseKrc,
    unescapeHtml
  };
}
