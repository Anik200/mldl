# 🎵 Myhem's Lyric Downloader (Mldl)

> A minimal, frosted-glass web application to search, preview, and download Apple Music word-synced **.ttml** and Kugou **.krc** lyrics for complete albums or individual tracks as **.zip** archives.

---

## ✨ Features

- ⚙️ **Custom Filename Naming Format**:
  - Configure naming patterns directly in **Settings**:
    - `{track}. {title}` (e.g. `01. Hello.ttml`)
    - `{artist} - {title}` (e.g. `Adele - Hello.ttml`)
    - `{track} - {artist} - {title}` (e.g. `01 - Adele - Hello.ttml`)
    - `{title}` (e.g. `Hello.ttml`)
    - Or any custom template with tags: `{track}`, `{title}`, `{artist}`, `{album}` with live output preview!
- 💿 **Album Search & Candidate Chooser**:
  - Separate inputs for **Album Name** and **Artist Name**.
  - Displays all matched album editions (Standard, Deluxe, Vinyl, etc.) so you can select the exact album you want.
- 🎵 **Single Song Search**:
  - Separate inputs for **Song Title** and **Artist Name**.
  - Direct preview and download for individual tracks.
- 🎤 **Interactive Karaoke Preview**:
  - Live synchronized playback preview with word-by-word highlight animation.
  - Raw format viewer tabs with 1-click **Copy to Clipboard**.
- 📦 **Multiple Formats**:
  - **.ttml**: Apple Music / W3C compatible word-by-word synced XML.
  - **.krc**: Kugou decrypted word-by-word synced lyrics.
  - **Enhanced .lrc**: Word-synced timestamps (`<mm:ss.xx>`).
  - **Standard .lrc**: Standard line-synced timestamps (`[mm:ss.xx]`).
  - **.srt**: SubRip subtitle format.
  - **.json**: Structured raw timing objects.
- ⚡ **Pure Lyrics Only**:
  - Downloads only synchronized lyric files (zero album art or music overhead) packaged instantly into a `.zip`.
- 🔤 **CaskaydiaCove Nerd Font Bold**:
  - Clean monospace aesthetic typography across the entire interface.
- 🌐 **100% Client-Side Decryption**:
  - 16-byte XOR decryption and zlib inflation run directly in your browser.

---

## 🚀 Running Locally (Zero Configuration)

To run the web app on your computer with the built-in local proxy:

```bash
python server.py
```

Then open `http://localhost:8080` in your web browser.

---

## 🌐 Deploy to GitHub Pages (3 Steps)

1. **Push this repository to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Deploy Myhem's Lyric Downloader"
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git branch -M main
   git push -u origin main
   ```

2. **Enable GitHub Pages**:
   - Go to your repository on GitHub.
   - Click **Settings** $\rightarrow$ **Pages** (in the left sidebar).
   - Under **Build and deployment** $\rightarrow$ **Branch**, select `main` and folder `/ (root)`.
   - Click **Save**.

3. **Open Your Live Site**:
   - In 1–2 minutes, your web application will be live at:
     `https://<your-username>.github.io/<your-repo-name>/`

---

## 📁 Repository Structure

```
├── index.html            # Main Single Page Application
├── server.py             # Local Python Development & Proxy Server
├── worker.js             # Optional Cloudflare Worker Proxy
├── kugou_album.py        # Original Python CLI script
├── css/
│   └── style.css         # Minimal dark frosted-glass stylesheet
├── js/
│   ├── krc-decoder.js    # JavaScript XOR decryption & Zlib inflate
│   ├── converters.js     # TTML, LRC, SRT, JSON exporters
│   ├── api.js            # Kugou search & catalog API client
│   └── app.js            # UI controller, karaoke player, JSZip packaging
└── vendor/
    ├── pako.min.js       # Fast Zlib decompression
    └── jszip.min.js      # In-browser ZIP file generator
```
