#!/usr/bin/env python3
"""
Kugou Album Word-Synced Lyrics Downloader & Converter
Downloads .krc and .ttml (Apple Music / W3C word-synced) lyrics for entire albums at once.
Supports: .krc, .ttml, .lrc (enhanced/standard), .srt, .json
"""

import os
import re
import sys
import json
import zlib
import html
import time
import base64
import argparse
import urllib.request
import urllib.parse
import xml.sax.saxutils as saxutils
from concurrent.futures import ThreadPoolExecutor, as_completed

# 16-byte XOR key for Kugou KRC
KRC_XOR_KEY = [
    0x40, 0x47, 0x61, 0x77, 0x5E, 0x32, 0x74, 0x47,
    0x51, 0x36, 0x31, 0x2D, 0xCE, 0xD2, 0x6E, 0x69
]

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


# ==============================================================================
# Helper & Parsing Functions
# ==============================================================================

def sanitize_filename(name):
    """Remove illegal filesystem characters from string."""
    name = re.sub(r"[、/]", " ", str(name))
    name = re.sub(r'[\\*?:"<>|]', "", name)
    return re.sub(r"\s+", " ", name).strip()


def parse_and_clean_album_query(raw_query):
    """
    Parse natural language album queries.
    E.g. 'Random Access Memories by Daft Punk' -> ['Daft Punk Random Access Memories', ...]
    """
    query = raw_query.strip()
    # Check if URL or direct digits
    url_match = re.search(r"album(?:id|/single|/info)?/(\d+)", query)
    if url_match:
        return [url_match.group(1)]
    if query.isdigit():
        return [query]

    variations = []

    # Pattern: "Album by Artist"
    by_match = re.match(r"^(.+?)\s+by\s+(.+)$", query, re.IGNORECASE)
    if by_match:
        album = by_match.group(1).strip()
        artist = by_match.group(2).strip()
        variations.append(f"{artist} {album}")
        variations.append(f"{album} {artist}")
        variations.append(f"{artist}")
        variations.append(f"{album}")

    # Pattern: "Artist - Album"
    dash_match = re.match(r"^(.+?)\s*-\s*(.+)$", query)
    if dash_match:
        part1 = dash_match.group(1).strip()
        part2 = dash_match.group(2).strip()
        variations.append(f"{part1} {part2}")
        variations.append(f"{part2} {part1}")
        variations.append(f"{part1}")
        variations.append(f"{part2}")

    # Remove filler words
    cleaned = re.sub(r"\b(by|album|full album|explicit|deluxe|edition|cd|disc|audio|lyrics|official)\b", " ", query, flags=re.IGNORECASE)
    cleaned = re.sub(r"[^\w\s\u4e00-\u9fff]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if cleaned and cleaned not in variations:
        variations.append(cleaned)

    if query not in variations:
        variations.append(query)

    return variations


def score_album_candidate(candidate, raw_query):
    """
    Score album candidates based on query token matches, penalizing tributes and covers.
    """
    singer = (candidate.get("singername") or "").lower()
    album = (candidate.get("albumname") or "").lower()
    combined = f"{singer} {album}"
    query_lower = raw_query.lower()

    score = 0

    # Penalize tribute / cover / karaoke unless requested
    unwanted_tokens = ["tribute", "originally performed by", "karaoke", "instrumental", "backing track", "performs", "tribute band"]
    for ut in unwanted_tokens:
        if ut in combined and ut not in query_lower:
            score -= 200

    # Match tokens from query
    query_words = [w for w in re.split(r"[\s\-_,.]+", query_lower) if w and w not in ("by", "the", "a", "an", "and", "in", "of", "to", "for")]
    matched_words = 0
    for w in query_words:
        if len(w) > 0 and w in combined:
            score += 40
            matched_words += 1
        if len(w) > 0 and w in album:
            score += 30
        if len(w) > 0 and w in singer:
            score += 30

    # Big bonus if all main query words are present
    if query_words and matched_words == len(query_words):
        score += 120

    # Prefer albums with verified track count
    try:
        song_count = int(candidate.get("songcount") or 0)
    except (ValueError, TypeError):
        song_count = 0

    if song_count > 0:
        score += min(song_count * 2, 40)

    return score


# ==============================================================================
# Kugou API Functions
# ==============================================================================

def search_album_api(keyword, page=1, pagesize=10):
    """Search Kugou mobile catalog for albums."""
    if not keyword.strip():
        return []
    url = f"http://mobilecdn.kugou.com/api/v3/search/album?format=json&keyword={urllib.parse.quote(keyword)}&page={page}&pagesize={pagesize}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("data", {}).get("info", [])
    except Exception:
        return []


def find_albums(raw_query):
    """
    Search Kugou for albums matching query and rank by relevance score.
    """
    variations = parse_and_clean_album_query(raw_query)

    # Check if direct album ID
    if len(variations) == 1 and variations[0].isdigit():
        album_id = int(variations[0])
        info = get_album_info(album_id)
        if info:
            return [{
                "albumid": album_id,
                "singername": info.get("singername", "Unknown Artist"),
                "albumname": info.get("albumname", f"Album {album_id}"),
                "songcount": info.get("songcount", 0),
                "publishtime": info.get("publishtime", ""),
                "imgurl": info.get("imgurl", "")
            }]
        return [{"albumid": album_id, "singername": "Unknown", "albumname": f"Album {album_id}", "songcount": 0}]

    all_candidates = []
    seen_ids = set()

    for q_var in variations:
        results = search_album_api(q_var, page=1, pagesize=12)
        for r in results:
            aid = r.get("albumid")
            if aid and aid not in seen_ids:
                seen_ids.add(aid)
                all_candidates.append(r)
        if len(all_candidates) >= 6:
            break

    # Sort candidates by relevance
    all_candidates.sort(key=lambda c: score_album_candidate(c, raw_query), reverse=True)
    return all_candidates


def get_album_info(album_id):
    """Retrieve detailed metadata for an album."""
    url = f"http://mobilecdn.kugou.com/api/v3/album/info?format=json&albumid={album_id}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("status") == 1:
            return data.get("data", {})
    except Exception:
        pass
    return {}


def get_album_tracks(album_id):
    """Retrieve complete song list for an album, handling pagination."""
    tracks = []
    page = 1
    page_size = 100

    while True:
        url = f"http://mobilecdn.kugou.com/api/v3/album/song?format=json&albumid={album_id}&page={page}&pagesize={page_size}"
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if data.get("status") != 1:
                break
            info_list = data.get("data", {}).get("info", [])
            if not info_list:
                break
            tracks.extend(info_list)

            total = data.get("data", {}).get("total", len(tracks))
            if len(tracks) >= total or len(info_list) < page_size:
                break
            page += 1
        except Exception as e:
            print(f"[!] Error fetching tracks page {page}: {e}")
            break

    return tracks


def search_lyrics_api(keyword=None, song_hash=None, duration_ms=None):
    """Search lyrics.kugou.com/search using file hash or keyword."""
    params = {"ver": "1", "man": "yes", "client": "pc"}
    if keyword:
        params["keyword"] = keyword
    if song_hash:
        params["hash"] = song_hash
    if duration_ms:
        params["duration"] = str(duration_ms)

    url = f"http://lyrics.kugou.com/search?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("status") == 200:
            return data.get("candidates", [])
    except Exception:
        pass
    return []


def search_mobilecdn_songs(keyword):
    """Search Kugou mobile music catalog."""
    url = f"http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword={urllib.parse.quote(keyword)}&page=1&pagesize=10&showtype=1"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("data", {}).get("info", [])
    except Exception:
        return []


def score_song_candidate(candidate, raw_query):
    """Score song lyric candidate based on text match and word sync format."""
    singer = (candidate.get("singer") or "").lower()
    song = (candidate.get("song") or "").lower()
    combined = f"{singer} {song}"
    query_lower = raw_query.lower()

    score = candidate.get("score", 0)

    # Penalize tribute / cover / karaoke
    unwanted = ["tribute", "originally performed by", "karaoke", "instrumental", "backing track"]
    for u in unwanted:
        if u in combined and u not in query_lower:
            score -= 150

    query_words = [w for w in re.split(r"\s+", query_lower) if w not in ("by", "the", "a", "an", "and", "in", "of", "to", "for")]
    matched = 0
    for w in query_words:
        if len(w) > 1 and w in combined:
            score += 30
            matched += 1
        if len(w) > 1 and w in song:
            score += 20

    if query_words and matched == len(query_words):
        score += 80

    if candidate.get("krctype") in (1, 2):
        score += 20

    return score


def find_lyrics_for_track(track_title, song_hash=None, duration_sec=None):
    """
    Find best word-synced lyric candidate for a track.
    1. Try exact file hash
    2. Try track title with lyrics API
    3. Try mobile catalog search for new hash
    """
    duration_ms = int(duration_sec * 1000) if duration_sec else None

    # Step 1: Query by Hash
    if song_hash:
        cands = search_lyrics_api(song_hash=song_hash, duration_ms=duration_ms)
        if cands:
            cands.sort(key=lambda c: (c.get("krctype") in (1, 2), c.get("score", 0)), reverse=True)
            return cands

    # Step 2: Query by Title
    cands = search_lyrics_api(keyword=track_title, duration_ms=duration_ms)
    if cands:
        cands.sort(key=lambda c: score_song_candidate(c, track_title), reverse=True)
        return cands

    # Step 3: Fallback through Mobile CDN Song Search
    songs = search_mobilecdn_songs(track_title)
    for s in songs[:4]:
        f_hash = s.get("hash")
        if f_hash:
            cands = search_lyrics_api(song_hash=f_hash)
            if cands:
                cands.sort(key=lambda c: (c.get("krctype") in (1, 2), c.get("score", 0)), reverse=True)
                return cands

    return []


# ==============================================================================
# Decryption & Format Conversion
# ==============================================================================

def decrypt_krc_bytes(raw_bytes):
    """Decrypt raw encrypted KRC bytes."""
    if raw_bytes.startswith(b"krc1"):
        payload = raw_bytes[4:]
    else:
        payload = raw_bytes

    decrypted_bytes = bytearray(len(payload))
    for i, b in enumerate(payload):
        decrypted_bytes[i] = b ^ KRC_XOR_KEY[i % len(KRC_XOR_KEY)]

    return zlib.decompress(decrypted_bytes).decode("utf-8", errors="replace")


def download_and_decrypt_krc(lyric_id, accesskey):
    """Download base64 payload from Kugou and decrypt."""
    params = {
        "ver": "1",
        "client": "pc",
        "id": lyric_id,
        "accesskey": accesskey,
        "fmt": "krc",
        "charset": "utf8"
    }
    url = f"http://lyrics.kugou.com/download?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    if data.get("status") != 200:
        raise RuntimeError(f"Download failed: {data.get('errmsg', 'Unknown error')}")

    raw_bytes = base64.b64decode(data.get("content", ""))
    return html.unescape(decrypt_krc_bytes(raw_bytes))


def parse_krc(krc_text):
    """Parse raw KRC text into structured line & word timing objects."""
    meta = {}
    lines = []

    for raw_line in krc_text.splitlines():
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        meta_match = re.match(r"^\[([a-zA-Z_]+):(.*)\]$", raw_line)
        if meta_match:
            meta[meta_match.group(1)] = html.unescape(meta_match.group(2).strip())
            continue

        line_match = re.match(r"^\[(\d+),(\d+)\](.*)$", raw_line)
        if line_match:
            start_ms = int(line_match.group(1))
            duration_ms = int(line_match.group(2))
            rest = line_match.group(3)

            word_matches = re.findall(r"<(\d+),(\d+),\d+>([^<]*)", rest)
            words = []
            for w_offset, w_dur, w_text in word_matches:
                w_off = int(w_offset)
                w_d = int(w_dur)
                w_clean = html.unescape(w_text)
                words.append({
                    "text": w_clean,
                    "offset_ms": w_off,
                    "duration_ms": w_d,
                    "start_ms": start_ms + w_off,
                    "end_ms": start_ms + w_off + w_d
                })

            lines.append({
                "start_ms": start_ms,
                "duration_ms": duration_ms,
                "end_ms": start_ms + duration_ms,
                "text": "".join(w["text"] for w in words),
                "words": words
            })

    return {"meta": meta, "lines": lines}


def format_ms_to_ttml_time(ms):
    """Convert milliseconds to hh:mm:ss.mmm for TTML begin/end tags."""
    hours = int(ms // 3600000)
    minutes = int((ms % 3600000) // 60000)
    seconds = int((ms % 60000) // 1000)
    millis = int(ms % 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def format_ms_to_lrc_tag(ms):
    """Convert milliseconds to [mm:ss.xx]"""
    total_seconds = ms / 1000.0
    minutes = int(total_seconds // 60)
    seconds = total_seconds % 60
    return f"[{minutes:02d}:{seconds:05.2f}]"


def format_ms_to_word_tag(ms):
    """Convert milliseconds to <mm:ss.xx>"""
    total_seconds = ms / 1000.0
    minutes = int(total_seconds // 60)
    seconds = total_seconds % 60
    return f"<{minutes:02d}:{seconds:05.2f}>"


def format_ms_to_srt_time(ms):
    """Convert milliseconds to hh:mm:ss,mmm"""
    hours = int(ms // 3600000)
    minutes = int((ms % 3600000) // 60000)
    seconds = int((ms % 60000) // 1000)
    millis = int(ms % 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def convert_to_ttml(parsed_data, default_artist="", default_title="", default_album="", language="en"):
    """
    Convert parsed KRC data into standard word-by-word synced TTML (W3C / Apple Music compatible).
    """
    meta = parsed_data.get("meta", {})
    title = saxutils.escape(html.unescape(meta.get("ti") or default_title or "Unknown Title"))
    artist = saxutils.escape(html.unescape(meta.get("ar") or default_artist or "Unknown Artist"))
    album = saxutils.escape(html.unescape(meta.get("al") or default_album or ""))

    lines_xml = []
    for line in parsed_data.get("lines", []):
        p_begin = format_ms_to_ttml_time(line["start_ms"])
        p_end = format_ms_to_ttml_time(line["end_ms"])

        spans = []
        for word in line.get("words", []):
            w_begin = format_ms_to_ttml_time(word["start_ms"])
            w_end = format_ms_to_ttml_time(word["end_ms"])
            w_clean = html.unescape(word["text"])
            w_escaped = saxutils.escape(w_clean)
            spans.append(f'<span begin="{w_begin}" end="{w_end}">{w_escaped}</span>')

        spans_str = "".join(spans)
        lines_xml.append(f'      <p begin="{p_begin}" end="{p_end}">{spans_str}</p>')

    body_content = "\n".join(lines_xml)

    ttml_output = f"""<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"
    xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xmlns:itunes="http://music.apple.com/metadata"
    itunes:timing="Word"
    xml:lang="{language}">
  <head>
    <metadata>
      <ttm:title>{title}</ttm:title>
      <ttm:agent type="person">{artist}</ttm:agent>
      {f'<ttm:copyright>{album}</ttm:copyright>' if album else ''}
    </metadata>
  </head>
  <body>
    <div>
{body_content}
    </div>
  </body>
</tt>"""
    return ttml_output


def convert_to_enhanced_lrc(parsed_data):
    """Convert parsed KRC data to Enhanced LRC (word-synced timestamps)."""
    out = []
    meta = parsed_data.get("meta", {})
    for k in ["ti", "ar", "al", "by", "offset"]:
        if k in meta:
            out.append(f"[{k}:{html.unescape(str(meta[k]))}]")

    for line in parsed_data.get("lines", []):
        line_tag = format_ms_to_lrc_tag(line["start_ms"])
        word_parts = []
        for w in line.get("words", []):
            word_tag = format_ms_to_word_tag(w["start_ms"])
            word_parts.append(f"{word_tag}{html.unescape(w['text'])}")
        out.append(f"{line_tag}{''.join(word_parts)}")

    return "\n".join(out)


def convert_to_standard_lrc(parsed_data):
    """Convert parsed KRC data to standard line-synced LRC."""
    out = []
    meta = parsed_data.get("meta", {})
    for k in ["ti", "ar", "al", "by", "offset"]:
        if k in meta:
            out.append(f"[{k}:{html.unescape(str(meta[k]))}]")

    for line in parsed_data.get("lines", []):
        line_tag = format_ms_to_lrc_tag(line["start_ms"])
        out.append(f"{line_tag}{html.unescape(line['text'])}")

    return "\n".join(out)


def convert_to_srt(parsed_data):
    """Convert parsed KRC data to SRT subtitles."""
    out = []
    for idx, line in enumerate(parsed_data.get("lines", []), start=1):
        start_srt = format_ms_to_srt_time(line["start_ms"])
        end_srt = format_ms_to_srt_time(line["end_ms"])
        text = html.unescape(line["text"])
        out.append(f"{idx}\n{start_srt} --> {end_srt}\n{text}\n")
    return "\n".join(out)


# ==============================================================================
# Track Processing & Album Download Workflow
# ==============================================================================

def download_track_lyrics(track_info, album_meta, output_dir, formats, track_idx, total_tracks, prefix_track_num=True, skip_existing=False):
    """
    Process and download lyrics for a single track.
    Returns (track_idx, status_msg, success_bool, saved_files)
    """
    raw_filename = track_info.get("filename", "Unknown Track")
    song_hash = track_info.get("hash")
    duration = track_info.get("duration", 0)

    # Format base file name
    clean_title = sanitize_filename(raw_filename)
    if prefix_track_num:
        num_str = f"{track_idx:02d}" if total_tracks < 100 else f"{track_idx:03d}"
        file_base = f"{num_str}. {clean_title}"
    else:
        file_base = clean_title

    # Target file formats
    save_formats = formats if isinstance(formats, list) else [formats]
    if "both" in save_formats:
        save_formats = ["krc", "ttml"]
    elif "all" in save_formats:
        save_formats = ["krc", "ttml", "enhanced-lrc", "standard-lrc", "srt", "json"]

    # Check if all desired output files already exist
    all_exist = True
    for fmt in save_formats:
        ext = "lrc" if "lrc" in fmt else fmt
        path = os.path.join(output_dir, f"{file_base}.{ext}")
        if not os.path.exists(path):
            all_exist = False
            break

    if skip_existing and all_exist:
        return (track_idx, f"Skipped (already exists)", True, [f"{file_base}.*"])

    # Search for lyrics
    candidates = find_lyrics_for_track(raw_filename, song_hash=song_hash, duration_sec=duration)
    if not candidates:
        return (track_idx, f"No lyrics found on Kugou", False, [])

    chosen = candidates[0]
    lyric_id = chosen.get("id")
    accesskey = chosen.get("accesskey")

    try:
        raw_krc_text = download_and_decrypt_krc(lyric_id, accesskey)
        parsed = parse_krc(raw_krc_text)
    except Exception as e:
        return (track_idx, f"Download/decrypt error: {e}", False, [])

    saved_files = []
    singer_name = album_meta.get("singername", "")
    album_name = album_meta.get("albumname", "")

    # Save outputs
    for fmt in save_formats:
        if fmt == "krc":
            out_content = raw_krc_text
            ext = "krc"
        elif fmt == "ttml":
            out_content = convert_to_ttml(parsed, default_artist=singer_name, default_title=clean_title, default_album=album_name)
            ext = "ttml"
        elif fmt == "enhanced-lrc":
            out_content = convert_to_enhanced_lrc(parsed)
            ext = "lrc"
        elif fmt == "standard-lrc":
            out_content = convert_to_standard_lrc(parsed)
            ext = "lrc"
        elif fmt == "srt":
            out_content = convert_to_srt(parsed)
            ext = "srt"
        elif fmt == "json":
            out_content = json.dumps(parsed, indent=2, ensure_ascii=False)
            ext = "json"
        else:
            continue

        target_file = os.path.join(output_dir, f"{file_base}.{ext}")
        with open(target_file, "w", encoding="utf-8") as f:
            f.write(out_content)
        saved_files.append(f"{file_base}.{ext}")

    formats_label = "+".join(f.upper() for f in save_formats)
    return (track_idx, f"Downloaded [{formats_label}]", True, saved_files)


def download_album(album_data, output_dir=None, formats="both", prefix_track_num=True,
                   skip_existing=False, save_cover=False, save_info=False, workers=3):
    """
    Main album download orchestrator.
    """
    album_id = album_data.get("albumid")
    singer = album_data.get("singername", "Unknown Artist").strip()
    album_name = album_data.get("albumname", "Unknown Album").strip()
    publish_time = (album_data.get("publishtime") or "")[:10]

    # Fetch album info for rich metadata if missing
    detailed_info = get_album_info(album_id)
    if detailed_info:
        singer = detailed_info.get("singername") or singer
        album_name = detailed_info.get("albumname") or album_name
        publish_time = (detailed_info.get("publishtime") or publish_time)[:10]

    # Setup output directory
    if not output_dir:
        folder_name = sanitize_filename(f"{singer} - {album_name}")
        output_dir = os.path.join(os.getcwd(), folder_name)

    os.makedirs(output_dir, exist_ok=True)

    print(f"\n=======================================================")
    print(f" Album:        {album_name}")
    print(f" Artist:       {singer}")
    print(f" Release Date: {publish_time if publish_time else 'N/A'}")
    print(f" Album ID:     {album_id}")
    print(f" Destination:  {output_dir}")
    print(f" Formats:      {formats}")
    print(f"=======================================================\n")

    # Save Album Cover Artwork if requested
    img_url = detailed_info.get("imgurl") or album_data.get("imgurl")
    if save_cover and img_url:
        cover_url = img_url.replace("{size}", "400") if "{size}" in img_url else img_url
        try:
            req = urllib.request.Request(cover_url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=8) as resp:
                cover_data = resp.read()
            cover_path = os.path.join(output_dir, "cover.jpg")
            with open(cover_path, "wb") as f:
                f.write(cover_data)
            print(f"[+] Saved album cover art: cover.jpg")
        except Exception as e:
            print(f"[!] Could not download cover art: {e}")

    # Save Album Metadata JSON if requested
    if save_info:
        info_path = os.path.join(output_dir, "album_info.json")
        full_meta = {**album_data, **detailed_info}
        try:
            with open(info_path, "w", encoding="utf-8") as f:
                json.dump(full_meta, f, indent=2, ensure_ascii=False)
            print(f"[+] Saved album metadata: album_info.json")
        except Exception as e:
            print(f"[!] Could not write album info: {e}")

    # Fetch tracklist
    print(f"[*] Fetching track list for album {album_id}...")
    tracks = get_album_tracks(album_id)
    total_tracks = len(tracks)

    if total_tracks == 0:
        print("[!] No tracks found in this album.")
        return

    print(f"[+] Found {total_tracks} tracks. Starting download...\n")

    successful_downloads = 0
    failed_downloads = 0

    # Sequential or Threaded processing
    if workers <= 1:
        for idx, track in enumerate(tracks, start=1):
            track_title = track.get("filename", f"Track {idx}")
            print(f"  [{idx:02d}/{total_tracks:02d}] {track_title} ... ", end="", flush=True)
            _, status_msg, ok, _ = download_track_lyrics(
                track, album_data, output_dir, formats, idx, total_tracks,
                prefix_track_num=prefix_track_num, skip_existing=skip_existing
            )
            if ok:
                print(f"OK ({status_msg})")
                successful_downloads += 1
            else:
                print(f"FAILED ({status_msg})")
                failed_downloads += 1
    else:
        # Concurrent downloads
        futures = {}
        with ThreadPoolExecutor(max_workers=workers) as executor:
            for idx, track in enumerate(tracks, start=1):
                f = executor.submit(
                    download_track_lyrics,
                    track, album_data, output_dir, formats, idx, total_tracks,
                    prefix_track_num=prefix_track_num, skip_existing=skip_existing
                )
                futures[f] = (idx, track.get("filename", f"Track {idx}"))

            # Order by completion or index
            results = []
            for f in as_completed(futures):
                idx, title = futures[f]
                try:
                    res = f.result()
                    results.append(res)
                except Exception as e:
                    results.append((idx, f"Error: {e}", False, []))

            # Sort by track index for clean summary
            results.sort(key=lambda r: r[0])
            for idx, status_msg, ok, _ in results:
                track_title = tracks[idx - 1].get("filename", f"Track {idx}")
                status_label = "OK" if ok else "FAILED"
                print(f"  [{idx:02d}/{total_tracks:02d}] {track_title} -> {status_label} ({status_msg})")
                if ok:
                    successful_downloads += 1
                else:
                    failed_downloads += 1

    # Summary
    print(f"\n-------------------------------------------------------")
    print(f" Album Download Complete:")
    print(f"   Total Tracks: {total_tracks}")
    print(f"   Successful:   {successful_downloads}")
    print(f"   Failed:       {failed_downloads}")
    print(f"   Saved Folder: {os.path.abspath(output_dir)}")
    print(f"-------------------------------------------------------\n")


# ==============================================================================
# CLI Entry Point
# ==============================================================================

def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description="Download word-synced (.krc & .ttml) lyrics for a complete album from Kugou."
    )
    parser.add_argument(
        "album",
        nargs="?",
        help="Album query, title & artist (e.g. 'Random Access Memories by Daft Punk', 'Adele - 21', or Kugou Album ID / URL)"
    )
    parser.add_argument(
        "--album-id", "-a",
        type=int,
        help="Direct Kugou album ID (e.g. 962867)"
    )
    parser.add_argument(
        "-o", "--output-dir",
        help="Output folder directory (default: './<Artist> - <Album>/')"
    )
    parser.add_argument(
        "-f", "--format",
        choices=["both", "ttml", "krc", "enhanced-lrc", "standard-lrc", "srt", "json", "all"],
        default="both",
        help="Output format to save: 'both' (KRC + TTML, default), 'ttml', 'krc', 'enhanced-lrc', 'standard-lrc', 'srt', 'all'"
    )
    parser.add_argument(
        "--save-cover",
        action="store_true",
        help="Download and save the album cover artwork image (cover.jpg)"
    )
    parser.add_argument(
        "--save-info",
        action="store_true",
        help="Save album metadata to album_info.json"
    )
    parser.add_argument(
        "--candidate", "-c",
        type=int,
        default=0,
        help="Candidate index to select from search results (default: 0 = best match)"
    )
    parser.add_argument(
        "--list", "-l",
        action="store_true",
        help="List available album search candidates without downloading"
    )
    parser.add_argument(
        "--workers", "-w",
        type=int,
        default=3,
        help="Number of concurrent download worker threads (default: 3)"
    )
    parser.add_argument(
        "--no-track-numbers",
        action="store_true",
        help="Do not prefix filenames with track numbers (01., 02., etc.)"
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip tracks whose lyric files already exist in destination"
    )

    args = parser.parse_args()

    # Direct Album ID mode
    if args.album_id:
        target_aid = args.album_id
        info = get_album_info(target_aid)
        album_data = {
            "albumid": target_aid,
            "singername": info.get("singername", "Unknown Artist"),
            "albumname": info.get("albumname", f"Album {target_aid}"),
            "songcount": info.get("songcount", 0),
            "publishtime": info.get("publishtime", ""),
            "imgurl": info.get("imgurl", "")
        }
        download_album(
            album_data,
            output_dir=args.output_dir,
            formats=args.format,
            prefix_track_num=not args.no_track_numbers,
            skip_existing=args.skip_existing,
            save_cover=args.save_cover,
            save_info=args.save_info,
            workers=args.workers
        )
        return

    if not args.album:
        parser.print_help()
        sys.exit(1)

    print(f"[*] Searching albums for: '{args.album}'...")
    candidates = find_albums(args.album)

    if not candidates:
        print("[!] No albums found. Try refining your search query or specifying --album-id.")
        sys.exit(1)

    if args.list:
        print(f"\n[+] Found {len(candidates)} album candidates:")
        for idx, c in enumerate(candidates):
            aid = c.get("albumid")
            singer = c.get("singername", "Unknown Artist")
            album_name = c.get("albumname", "Unknown Album")
            songs = c.get("songcount", "?")
            pub_date = (c.get("publishtime") or "")[:10]
            print(f"  [{idx}] {singer} - {album_name} (Tracks: {songs}, Released: {pub_date if pub_date else 'N/A'}, ID: {aid})")
        return

    sel_idx = max(0, min(args.candidate, len(candidates) - 1))
    chosen_album = candidates[sel_idx]

    print(f"[+] Selected candidate [{sel_idx}]: {chosen_album.get('singername')} - {chosen_album.get('albumname')} (ID: {chosen_album.get('albumid')})")

    download_album(
        chosen_album,
        output_dir=args.output_dir,
        formats=args.format,
        prefix_track_num=not args.no_track_numbers,
        skip_existing=args.skip_existing,
        save_cover=args.save_cover,
        save_info=args.save_info,
        workers=args.workers
    )


if __name__ == "__main__":
    main()
