const downloads = new Map();
const maxBytes = 20 * 1024 * 1024;

export async function handleThemeDownload(event, container, fetcher = fetch) {
    if (!/^[a-f0-9-]{36}$/.test(event.id)) return;
    const key = event.id;
    if (event.phase === 'theme-download-cancel') {
        downloads.get(key)?.abort();
        return;
    }
    const url = new URL(event.url);
    if (url.origin !== 'https://github.com' ||
        !/^\/firekylin\/themes\/releases\/download\/[a-z0-9][a-z0-9._+-]*\/[a-z0-9][a-z0-9._+-]*\.zip$/i.test(url.pathname) ||
        url.search || url.hash || url.username || url.password || downloads.has(key)) return;
    const controller = new AbortController();
    downloads.set(key, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]);
    const target = `.theme-downloads/${key}`;
    let body = new Uint8Array();
    let metadata;
    try {
        try {
            const response = await fetcher(`/api/theme?url=${encodeURIComponent(url.href)}`, {
                credentials: 'same-origin', signal, redirect: 'error'
            });
            if (!response.ok || !response.headers.get('content-type')?.includes('application/zip')) {
                await response.body?.cancel();
                throw new Error(`Theme proxy returned HTTP ${response.status}; expected a ZIP archive`);
            }
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            try {
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > maxBytes) throw new Error('Theme archive exceeds 20 MiB');
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
        await container.fs.mkdir('.theme-downloads', {recursive: true});
        await container.fs.writeFile(`${target}.tmp`, packet);
        if (!controller.signal.aborted) await container.fs.rename(`${target}.tmp`, target);
    } finally {
        downloads.delete(key);
        await container.fs.rm(`${target}.tmp`, {force: true}).catch(() => {});
        if (controller.signal.aborted) await container.fs.rm(target, {force: true}).catch(() => {});
    }
}
