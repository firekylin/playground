// Public provider discovery only. Never accept authorization codes or target URLs.
export const maxDuration = 10;

export async function discoverServices(fetcher = fetch) {
    const response = await fetcher('https://oauth.lithub.cc/', {
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
        headers: {'user-agent': 'Firekylin'}
    });
    if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error('OAuth discovery unavailable');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 64 * 1024) throw new Error('OAuth discovery response too large');
            chunks.push(Buffer.from(value));
        }
    } finally {
        await reader.cancel();
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!payload || !Array.isArray(payload.services)) throw new Error('Invalid OAuth discovery response');
    return {services: payload.services.filter(item => item &&
        typeof item.name === 'string' && /^[a-z][a-z0-9_-]{0,31}$/i.test(item.name))
        .map(item => ({name: item.name, title: typeof item.title === 'string' ? item.title : item.name}))};
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        res.writeHead(405).end();
        return;
    }
    if (new URL(req.url, 'http://localhost').search) {
        res.writeHead(400).end('OAuth discovery does not accept parameters');
        return;
    }
    try {
        const payload = await discoverServices();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
        res.end(JSON.stringify(payload));
    } catch {
        res.writeHead(502).end('OAuth discovery unavailable');
    }
}
