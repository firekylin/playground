const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');

// The host page downloads with its own session; no browser credentials enter Node.
module.exports = function installThemeProxy(enabled, options = {}) {
    if (!enabled) return;
    const directory = options.directory || path.join(__dirname, '.theme-downloads');
    const emit = options.emit || (value => console.log('PLAYGROUND_EVENT ' + JSON.stringify(value)));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        const method = init.method || input.method || 'GET';
        if (url.origin !== 'https://github.com' ||
            !/^\/firekylin\/themes\/releases\/download\/[a-z0-9][a-z0-9._+-]*\/[a-z0-9][a-z0-9._+-]*\.zip$/i.test(url.pathname) ||
            url.search || url.hash || url.username || url.password || method !== 'GET') {
            return originalFetch(input, init);
        }
        const id = randomUUID();
        const target = path.join(directory, id);
        const signal = AbortSignal.any([init.signal || input.signal || new AbortController().signal, AbortSignal.timeout(45000)]);
        await fs.mkdir(directory, {recursive: true});
        signal.throwIfAborted();
        emit({phase: 'theme-download', id, url: url.href});
        try {
            while (true) {
                signal.throwIfAborted();
                try {
                    const packet = await fs.readFile(target);
                    const length = packet.readUInt32BE(0);
                    const metadata = JSON.parse(packet.subarray(4, 4 + length).toString());
                    if (metadata.error) throw new Error(metadata.error);
                    return new Response(packet.subarray(4 + length), {status: metadata.status});
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                }
                await delay(50, undefined, {signal});
            }
        } finally {
            emit({phase: 'theme-download-cancel', id});
            await fs.rm(target, {force: true});
        }
    };
};
