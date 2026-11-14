import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { parseBlueprint, presets } from '../blueprint.mjs';
import { decodeConfiguration } from '../library.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
test('central launch, bilingual UI, loading recovery and runtime locale synchronization', async () => {
    const dom = new JSDOM(await readFile(new URL('../index.html', import.meta.url), 'utf8'), {
        url: 'http://localhost:4178/?lang=en-US',
        runScripts: 'outside-only'
    });
    const w = dom.window;
    const $ = (selector) => w.document.querySelector(selector);
    let copied;
    let currentLocale;
    let ready;
    let writtenConfiguration;
    let rejectBoot;
    w.HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    w.HTMLDialogElement.prototype.close = function () {
        this.open = false;
    };
    const source = await readFile(new URL('../i18n.mjs', import.meta.url), 'utf8');
    w.eval(source.replace(/export /g, '') + '\nwindow.i18n = {t, language, translatePage};');
    const runtime = {
        fs: {
            writeFile: async (file, value) => {
                if (file === 'blueprint.json') writtenConfiguration = JSON.parse(value);
            },
            readFile: async () => JSON.stringify({ landingPage: '/admin' }),
            mkdir: async () => {}
        },
        mount: async () => {},
        on: (event, callback) => {
            ready = callback;
        },
        spawn: async (command, args) => {
            if (args[0] === '--version')
                return {
                    output: new ReadableStream({
                        start(controller) {
                            controller.enqueue('v24\n');
                            controller.close();
                        }
                    }),
                    exit: Promise.resolve(0)
                };
            setTimeout(() => ready(8360, 'https://preview.example'), 0);
            return { output: new ReadableStream(), exit: new Promise(() => {}), kill() {} };
        },
        teardown() {}
    };
    Object.assign(w, {
        ...w.i18n,
        parseBlueprint,
        presets,
        decodeConfiguration,
        setupDevtools: () => ({
            ready() {},
            async setLocale(locale) {
                currentLocale = locale;
            }
        }),
        WebContainer: {
            boot: () =>
                new Promise((resolve, reject) => {
                    rejectBoot = reject;
                })
        },
        crossOriginIsolated: true,
        WritableStream,
        fetch: async (path) => ({ ok: true, json: async () => (path === '/snapshots.json' ? [] : {}) })
    });
    Object.defineProperty(w.navigator, 'clipboard', {
        value: {
            writeText: async (value) => {
                copied = value;
            }
        }
    });
    const app = (await readFile(new URL('../app.js', import.meta.url), 'utf8')).replace(
        /^import .*;.*$/gm,
        ''
    );
    try {
        w.eval(app + '\nwindow.resetAttempt = () => { attempted = false; };');
        assert.equal(w.document.documentElement.lang, 'en-US');
        assert.equal($('#launch').getAttribute('aria-label'), 'Launch Firekylin');
        assert.equal($('#launch-label').textContent, 'Launch');
        assert.ok($('#launch svg'));
        assert.equal($('#front').textContent, 'Website');
        assert.equal($('#sound-toggle'), null);
        $('#share').click();
        await tick();
        assert.match(copied, /lang=en-US/);
        $('#launch').click();
        assert.equal($('#launch-loading').hidden, false);
        assert.equal($('#language').disabled, true);
        rejectBoot(new Error('simulated boot failure'));
        await tick();
        assert.equal($('#launch-loading').hidden, true);
        assert.equal($('#launch').disabled, false);
        assert.ok($('#launch svg'));
        assert.equal($('#launch').getAttribute('aria-label'), 'Restart');
        assert.equal($('#launch-label').textContent, 'Restart');
        assert.equal($('#language').disabled, false);
        assert.match($('#logs-panel pre').textContent, /simulated boot failure/);
        // Re-run in the same test realm without a navigation to exercise server-ready handling.
        w.resetAttempt();
        w.WebContainer.boot = async () => runtime;
        $('#launch').click();
        await tick();
        await tick();
        assert.equal(writtenConfiguration.locale, 'en-US');
        assert.equal($('#launch-loading').hidden, false);
        $('iframe').dispatchEvent(new w.Event('load'));
        assert.equal($('#empty').hidden, true);
        $('#language').value = 'zh-CN';
        $('#language').dispatchEvent(new w.Event('change'));
        await tick();
        assert.equal(currentLocale, 'zh-CN');
        assert.equal(w.document.documentElement.lang, 'zh-CN');
        assert.equal($('#front').textContent, '网站');
        assert.equal($('iframe').src, 'https://preview.example/admin');
        assert.equal($('#run').textContent, '重新运行');
    } finally {
        w.close();
    }
});
