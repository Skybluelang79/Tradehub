const BACKEND_PATHS = ['/api', '/uploads', '/socket.io'];

function isBackendPath(pathname) {
  return BACKEND_PATHS.some((p) => pathname.startsWith(p));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Proxy API/uploads/socket.io traffic to the backend server.
    // Set BACKEND_URL as an encrypted environment variable in the
    // Cloudflare dashboard, e.g. BACKEND_URL = https://your-backend.onrender.com
    const backendUrl = env.BACKEND_URL;

    if (isBackendPath(pathname)) {
      if (!backendUrl) {
        return new Response(
          JSON.stringify({ error: 'Backend not configured. Set the BACKEND_URL environment variable.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const target = new URL(backendUrl);
      url.hostname = target.hostname;
      url.protocol = target.protocol;
      url.port = target.port;

      const proxyRequest = new Request(url.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: 'follow',
      });

      return fetch(proxyRequest);
    }

    // Static assets from Cloudflare Pages
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 200) return asset;

    // SPA fallback → serve index.html for client-side routing
    const indexRequest = new Request(new URL('/', url), {
      method: 'GET',
      headers: request.headers,
    });
    return env.ASSETS.fetch(indexRequest);
  },
};