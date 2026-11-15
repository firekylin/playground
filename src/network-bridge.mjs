const downloads = new Map();

export async function handleNetworkRequest(event, container, fetcher = fetch) {
    if (!/^[a-f0-9-]{36}$/.test(event.id)) return;
    const key = event.id;
    if (event.phase === 'network-request-cancel') {
        downloads.get(key)?.abort();
        return;
    }
    const url = new URL(event.url);
    const theme = url.origin === 'https://github.com' &&
        /^\/firekylin\/themes\/releases\/download\/[a-z0-9][a-z0-9._+-]*\/[a-z0-9][a-z0-9._+-]*\.zip$/i.test(url.pathname);
    const services = url.origin === 'https://oauth.lithub.cc' && url.pathname === '/';
    if ((!theme && !services) ||
        url.search || url.hash || url.username || url.password || downloads.has(key)) return;
    const endpoint = services ? '/api/oauth-services' : `/api/theme?url=${encodeURIComponent(url.href)}`;
    const contentType = services ? 'application/json' : 'application/zip';
    const maxBytes = services ? 64 * 1024 : 20 * 1024 * 1024;
    const controller = new AbortController();
    downloads.set(key, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]);
    const target = `.network-responses/${key}`;
    let body = new Uint8Array();
    let metadata;
    try {
        try {
            const response = await fetcher(endpoint, {
                credentials: 'same-origin', signal, redirect: 'error'
            });
            if (!response.ok || !response.headers.get('content-type')?.includes(contentType)) {
                await response.body?.cancel();
                throw new Error(`Network proxy returned HTTP ${response.status}; expected ${contentType}`);
            }
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            try {
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > maxBytes) throw new Error('Proxy response exceeds size limit');
                    chunks.push(value);
                }
            } finally {
                await reader.cancel();
            }
            body = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                body.set(chunk, offset);
                offset += chunk.byteLength;
            }
            metadata = {status: response.status};
        } catch (error) {
            if (controller.signal.aborted) return;
            metadata = {error: error.message};
        }
        const header = new TextEncoder().encode(JSON.stringify(metadata));
        const packet = new Uint8Array(4 + header.length + body.length);
        new DataView(packet.buffer).setUint32(0, header.length);
        packet.set(header, 4);
        packet.set(body, 4 + header.length);
        await container.fs.mkdir('.network-responses', {recursive: true});
        await container.fs.writeFile(`${target}.tmp`, packet);
        if (!controller.signal.aborted) await container.fs.rename(`${target}.tmp`, target);
    } finally {
        downloads.delete(key);
        await container.fs.rm(`${target}.tmp`, {force: true}).catch(() => {});
        if (controller.signal.aborted) await container.fs.rm(target, {force: true}).catch(() => {});
    }
}
