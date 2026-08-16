#!/usr/bin/env python3
"""
Myhem's Lyric Downloader (Mldl) - Local Development & Proxy Server
Serves static web files and provides a built-in CORS proxy for Kugou APIs.
Zero external dependencies (uses Python standard library).
"""

import os
import sys
import json
import urllib.request
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8080
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

class MldlHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers to all responses
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        
        # Built-in Proxy endpoint: /api/proxy?url=<encoded_url>
        if parsed.path == "/api/proxy":
            query_params = urllib.parse.parse_qs(parsed.query)
            target_url = query_params.get("url", [""])[0]

            if not target_url:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error": "Missing url parameter"}')
                return

            try:
                req = urllib.request.Request(target_url, headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json, text/plain, */*"
                })
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = resp.read()
                    content_type = resp.headers.get("Content-Type", "application/json; charset=utf-8")

                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        # Default static file handling
        return super().do_GET()

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server_address = ("", PORT)
    httpd = HTTPServer(server_address, MldlHandler)
    print("=" * 60)
    print(" 🎵 Myhem's Lyric Downloader (Mldl) - Local Server")
    print(f" Local Web App: http://localhost:{PORT}")
    print(f" Proxy Endpoint: http://localhost:{PORT}/api/proxy?url=...")
    print(" Press Ctrl+C to stop server")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[!] Stopping server.")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
