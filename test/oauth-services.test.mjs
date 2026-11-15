import test from 'node:test';
import assert from 'node:assert/strict';
import handler, {discoverServices} from '../api/oauth-services.js';

test('discovery requests only the fixed public URL and returns provider metadata', async () => {
    const result = await discoverServices(async (url, options) => {
        assert.equal(url, 'https://oauth.lithub.cc/');
        assert.equal(options.redirect, 'error');
        assert.deepEqual(options.headers, {'user-agent': 'Firekylin'});
        return Response.json({services: [
            {name: 'github', title: 'GitHub', privateField: 'discard'},
            {name: 'invalid/path'}, {name: 'google'}, null
        ], privateField: 'discard'});
    });
    assert.deepEqual(result, {services: [
        {name: 'github', title: 'GitHub'}, {name: 'google', title: 'google'}
    ]});
});

test('discovery rejects upstream errors, invalid data and oversized responses', async () => {
    await assert.rejects(discoverServices(async () => new Response('', {status: 503})), /unavailable/);
    await assert.rejects(discoverServices(async () => Response.json({})), /Invalid/);
    await assert.rejects(discoverServices(async () => new Response('x'.repeat(65537))), /too large/);
});

test('endpoint rejects parameters and non-GET requests without contacting upstream', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('Unexpected upstream request'); };
    try {
        for (const [req, expected] of [
            [{method: 'POST', url: '/api/oauth-services'}, 405],
            [{method: 'GET', url: '/api/oauth-services?code=test'}, 400]
        ]) {
            let status;
            const res = {
                setHeader() {},
                writeHead(value) { status = value; return this; },
                end() {}
            };
            await handler(req, res);
            assert.equal(status, expected);
        }
    } finally {
        globalThis.fetch = original;
    }
});
