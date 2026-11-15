import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadTheme, themeUrl} from '../api/theme.js';

const url = 'https://github.com/firekylin/themes/releases/download/aafu-v0.1.0/aafu-0.1.0.zip';

test('only official release ZIP URLs are accepted', () => {
    assert.equal(themeUrl(url).href, url);
    for (const value of [url + '?x=1', url + '#x', url.replace('themes', 'other'),
        'http://127.0.0.1/secret', url.replace('github.com', 'github.com.evil.test'),
        url.replace('github.com', 'user:pass@github.com'), url.replace('.zip', '.js')]) {
        assert.throws(() => themeUrl(value));
    }
});

test('follows only the GitHub release asset redirect and preserves ZIP bytes', async () => {
    const calls = [];
    const data = new Uint8Array([80, 75, 3, 4, 0, 255]);
    const result = await downloadTheme(url, async(input, options) => {
        calls.push(String(input));
        assert.equal(options.redirect, 'manual');
        return calls.length === 1
            ? new Response(null, {status: 302, headers: {location: 'https://release-assets.githubusercontent.com/test.zip?token=public'}})
            : new Response(data);
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), data);
});

test('rejects external redirects, oversized archives and upstream errors', async () => {
    await assert.rejects(downloadTheme(url, async() => new Response(null, {
        status: 302, headers: {location: 'http://127.0.0.1/private'}
    })), /Untrusted/);
    await assert.rejects(downloadTheme(url, async() => new Response('zip', {
        headers: {'content-length': String(21 * 1024 * 1024)}
    })), /20 MiB/);
    await assert.rejects(downloadTheme(url, async() => new Response('missing', {status: 404})), /404/);
});

test('browser bridge transfers ZIP bytes, propagates errors and cancellation', async () => {
    const {createRequire} = await import('node:module');
    const fs = await import('node:fs/promises');
    const {tmpdir} = await import('node:os');
    const {join} = await import('node:path');
    const {handleNetworkRequest} = await import('../src/network-bridge.mjs');
    const require = createRequire(import.meta.url);
    const root = await fs.mkdtemp(join(tmpdir(), 'theme-bridge-'));
    const original = globalThis.fetch;
    const ordinary = [];
    const data = new Uint8Array([80, 75, 3, 4, 0, 255]);
    const container = {fs: Object.fromEntries(['mkdir', 'writeFile', 'rm'].map(name => [
        name, (file, ...args) => fs[name](join(root, file), ...args)
    ]))};
    container.fs.rename = (from, to) => fs.rename(join(root, from), join(root, to));
    let mode = 'success';
    let cancelled = false;
    const tasks = [];
    globalThis.fetch = async (...args) => {
        ordinary.push(args);
        return new Response('untouched');
    };
    try {
        require('../runtime/network-bridge.cjs')(true, {
            directory: join(root, '.network-responses'),
            emit: event => tasks.push(handleNetworkRequest(event, container, async (input, options) => {
                if (input === '/api/oauth-services') {
                    return Response.json({services: [{name: 'github', title: 'GitHub'}]});
                }
                assert.equal(input, `/api/theme?url=${encodeURIComponent(url)}`);
                assert.equal(options.credentials, 'same-origin');
                assert.equal(options.headers, undefined);
                if (mode === 'error') return new Response('login', {headers: {'content-type': 'text/html'}});
                if (mode === 'cancel') return new Promise((resolve, reject) => {
                    options.signal.addEventListener('abort', () => {
                        cancelled = true;
                        reject(options.signal.reason);
                    }, {once: true});
                });
                return new Response(data, {headers: {'content-type': 'application/zip'}});
            }))
        });
        assert.deepEqual(new Uint8Array(await (await fetch(url)).arrayBuffer()), data);
        assert.deepEqual(await (await fetch('https://oauth.lithub.cc')).json(), {
            services: [{name: 'github', title: 'GitHub'}]
        });
        mode = 'error';
        await assert.rejects(fetch(url), /expected application\/zip/);
        mode = 'cancel';
        const controller = new AbortController();
        const pending = fetch(new Request(url, {signal: controller.signal}));
        setTimeout(() => controller.abort(), 100);
        await assert.rejects(pending, /abort/i);
        await Promise.all(tasks);
        assert.equal(cancelled, true);
        assert.deepEqual(await fs.readdir(join(root, '.network-responses')), []);
        await fetch('https://registry.npmjs.org/example');
        await fetch(url, {method: 'POST'});
        await fetch('https://oauth.lithub.cc/github?code=test');
        await fetch('https://oauth.lithub.cc/?url=https://example.com');
        await fetch('https://oauth.lithub.cc/', {method: 'POST'});
        assert.equal(ordinary.length, 5);
        assert.equal(ordinary[0][0], 'https://registry.npmjs.org/example');
    } finally {
        globalThis.fetch = original;
        await fs.rm(root, {recursive: true, force: true});
    }
});

test('client disconnect cancels upstream and completes the proxy handler', async () => {
    const {createServer, get} = await import('node:http');
    const {once} = await import('node:events');
    const {default: handler} = await import('../api/theme.js');
    const original = globalThis.fetch;
    let cancelled = false;
    let complete;
    const completed = new Promise(resolve => { complete = resolve; });
    globalThis.fetch = async() => new Response(new ReadableStream({
        pull(controller) {
            controller.enqueue(new Uint8Array(64 * 1024));
        },
        cancel() {
            cancelled = true;
        }
    }));
    const server = createServer((req, res) => {
        handler(req, res).finally(complete);
    });
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        await new Promise((resolve, reject) => {
            const request = get(`http://127.0.0.1:${server.address().port}/api/theme?url=${encodeURIComponent(url)}`, response => {
                response.once('data', () => {
                    response.destroy();
                    resolve();
                });
            });
            request.on('error', reject);
        });
        let timer;
        try {
            await Promise.race([completed, new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Proxy did not finish after disconnect')), 2000);
            })]);
        } finally {
            clearTimeout(timer);
        }
        assert.equal(cancelled, true);
    } finally {
        globalThis.fetch = original;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
