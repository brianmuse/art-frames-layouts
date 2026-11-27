const backend = 'http://127.0.0.1:8765';
const challenge = () => new Response('Sign in with your Art Frames management account.', {
  status:401, headers:{'WWW-Authenticate':'Basic realm="Art Frames", charset="UTF-8"','Cache-Control':'no-store'},
});

export async function livePreview(authorization: string | null, mode: string | null) {
  if (!authorization?.startsWith('Basic ')) return challenge();
  void mode;
  try {
    // Fixed loopback destination only. Never log or persist the browser's credentials.
    const response = await fetch(`${backend}/screen/preview-data`, {
      headers:{Authorization:authorization}, redirect:'error', signal:AbortSignal.timeout(40000),
    });
    if (response.status === 401) return challenge();
    if (!response.ok || !response.body) throw new Error('Backend unavailable');
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 40_000_000) throw new Error('Preview too large');
        parts.push(value);
      }
    } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, any>;
  } catch {
    return new Response('Live preview is unavailable. Reconnect the Art Frames SSH tunnel and update Art Frames on the NAS, then retry. Use ?data=sample for design fixtures.', {status:503,headers:{'Cache-Control':'no-store'}});
  }
}
