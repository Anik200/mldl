/**
 * Cloudflare Worker for Kugou Lyrics Proxy
 * 
 * Instructions:
 * 1. Log in to dash.cloudflare.com -> Workers & Pages -> Create Worker
 * 2. Paste this code and click "Deploy".
 * 3. Copy your worker URL (e.g. https://kugou-proxy.yourname.workers.dev)
 * 4. Paste it in the Kugou Lyrics Hub Settings -> Custom Cloudflare Worker.
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight OPTIONS request
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
      // Forward request to Kugou with browser User-Agent
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*"
        }
      });

      const responseBody = await response.arrayBuffer();

      // Return response with CORS headers
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
};
