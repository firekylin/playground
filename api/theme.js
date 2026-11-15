import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const maxDuration = 60;
const maxBytes = 20 * 1024 * 1024;

export function themeUrl(value) {
  const url = new URL(value);
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash ||
      !/^\/firekylin\/themes\/releases\/download\/[a-z0-9][a-z0-9._+-]*\/[a-z0-9][a-z0-9._+-]*\.zip$/i.test(url.pathname)) {
    throw new Error('Only official Firekylin theme releases are allowed');
  }
  return url;
}

export async function downloadTheme(value, fetcher = fetch) {
  let url = themeUrl(value);
  const signal = AbortSignal.timeout(45000);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetcher(url, {redirect: 'manual', signal});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Missing release redirect');
      url = new URL(location, url);
      if (url.origin !== 'https://release-assets.githubusercontent.com' || url.username || url.password || url.hash) {
        throw new Error('Untrusted release redirect');
      }
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Theme download failed (${response.status})`);
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body.cancel();
      throw new Error('Theme archive exceeds 20 MiB');
    }
    return response;
  }
  throw new Error('Too many release redirects');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.writeHead(405).end();
    return;
  }
  const value = new URL(req.url, 'http://localhost').searchParams.get('url');
  try {
    themeUrl(value);
  } catch {
    res.writeHead(400).end('Invalid official theme URL');
    return;
  }
  try {
    const response = await downloadTheme(value);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
    let bytes = 0;
    // Pipeline propagates disconnects and backpressure to the upstream reader.
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          callback(new Error('Theme archive exceeds 20 MiB'));
          return;
        }
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), limiter, res);
  } catch {
    if (res.headersSent) res.destroy();
    else {
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(502).end('Official theme download failed');
    }
  }
}
