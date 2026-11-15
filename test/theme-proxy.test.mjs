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

test('runtime adapts only official downloads and keeps the abort signal', async () => {
    const {createRequire} = await import('node:module');
    const require = createRequire(import.meta.url);
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async(...args) => {
        calls.push(args);
        return new Response('zip');
    };
    try {
        require('../runtime/theme-proxy.cjs')('https://playground.example');
        const signal = new AbortController().signal;
        await fetch(new URL(url), {signal, redirect: 'manual', headers: {'user-agent': 'test'}});
        const target = new URL(calls[0][0]);
        assert.equal(target.origin, 'https://playground.example');
        assert.equal(target.pathname, '/api/theme');
        assert.equal(target.searchParams.get('url'), url);
        assert.equal(calls[0][1].signal, signal);
        assert.equal(calls[0][1].headers, undefined);
        await fetch('https://registry.npmjs.org/example');
        assert.equal(calls[1][0], 'https://registry.npmjs.org/example');
    } finally {
        globalThis.fetch = original;
    }
});
