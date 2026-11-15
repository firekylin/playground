import { t, language, translatePage } from './i18n.mjs';
// Native browser modules require explicit extensions.
import { WebContainer } from './sdk/index.js'; // eslint-disable-line import/extensions
import { setupDevtools } from './devtools.mjs';

const $ = (selector) => document.querySelector(selector);
const output = $('#logs-panel pre');
const button = $('#run');
const status = $('#status');
const progress = $('#progress');
let container;
let attempted = false;
let previewUrl;
let pendingLog = '';
let startupTimer;
let previewTimer;
let noticeTimer;
let runtimeReady = false;
const devtools = setupDevtools(() => {
    if (!container || !runtimeReady) throw new Error(t('请先启动当前 Playground，等待站点就绪。'));
    return container;
}, message);
function openPanel(id) {
    const panel = document.getElementById(id);
    if (!panel.open) panel.showModal();
}
for (const trigger of document.querySelectorAll('[data-panel]')) {
    trigger.addEventListener('click', () => openPanel(trigger.dataset.panel));
}
for (const close of document.querySelectorAll('[data-close]')) {
    close.addEventListener('click', () => close.closest('dialog').close());
}
function message(text) {
    if (text) {
        clearTimeout(noticeTimer);
        $('#notice').textContent = text;
        $('#notice').hidden = false;
        noticeTimer = setTimeout(() => {
            $('#notice').hidden = true;
        }, 6000);
    }
}
function event(value) {
    if (value.phase === 'initializing') status.textContent = t('正在初始化 Firekylin 和数据库…');
    if (value.phase === 'seeding') {
        status.textContent = t('正在初始化站点…');
        progress.value = 90;
    }
    if (value.phase === 'ready') {
        clearTimeout(startupTimer);
        progress.value = 100;
        status.textContent = t('站点已准备好，正在打开预览…');
    }
}
function log(text) {
    output.textContent = (output.textContent + text).slice(-50000);
    pendingLog += text;
    const lines = pendingLog.split('\n');
    pendingLog = lines.pop();
    for (const line of lines) {
        if (line.startsWith('PLAYGROUND_EVENT ')) {
            try {
                event(JSON.parse(line.slice('PLAYGROUND_EVENT '.length)));
            } catch {
                // Ordinary logs remain visible even if a progress event is malformed.
            }
        }
    }
}
let audioContext;
let audioTimer;
function stopLaunchSound() {
    clearTimeout(audioTimer);
    const previous = audioContext;
    audioContext = undefined;
    if (previous && previous.state !== 'closed') previous.close().catch(() => {});
}
async function playLaunchSound() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    stopLaunchSound();
    let context;
    try {
        context = new Audio();
        audioContext = context;
        await context.resume();
        if (context !== audioContext || context.state !== 'running') {
            if (context === audioContext) stopLaunchSound();
            return;
        }
        const now = context.currentTime;
        const master = context.createGain();
        master.gain.setValueAtTime(0.12, now);
        master.connect(context.destination);
        // An ascending energy sweep, followed by a soft three-note confirmation.
        function tone(frequency, endFrequency, delay, duration, volume, type = 'sine') {
            const oscillator = context.createOscillator();
            const envelope = context.createGain();
            const begin = now + delay;
            oscillator.type = type;
            oscillator.frequency.setValueAtTime(frequency, begin);
            oscillator.frequency.exponentialRampToValueAtTime(endFrequency, begin + duration);
            envelope.gain.setValueAtTime(0, begin);
            envelope.gain.linearRampToValueAtTime(volume, begin + 0.04);
            envelope.gain.exponentialRampToValueAtTime(0.001, begin + duration);
            oscillator.connect(envelope);
            envelope.connect(master);
            oscillator.start(begin);
            oscillator.stop(begin + duration + 0.02);
        }
        tone(110, 440, 0, 1.3, 0.35, 'triangle');
        tone(220, 880, 0.08, 1.1, 0.18);
        tone(659.25, 659.25, 0.85, 0.9, 0.24);
        tone(987.77, 987.77, 1.02, 0.85, 0.18);
        tone(1318.51, 1318.51, 1.19, 1.05, 0.12);
        audioTimer = setTimeout(stopLaunchSound, 2500);
    } catch {
        if (context === audioContext) stopLaunchSound();
        // Audio restrictions must never prevent the site from starting.
    }
}
window.addEventListener('pagehide', stopLaunchSound);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLaunchSound();
});
function navigate(path) {
    $('iframe').src = previewUrl + path;
    $('#preview').href = previewUrl + path;
}
async function start(event) {
    if (button.disabled) return;
    if (event?.type === 'click') playLaunchSound();
    if (attempted) {
        sessionStorage.setItem('firekylin-simple-autostart', '1');
        container?.teardown();
        location.reload();
        return;
    }
    attempted = true;
    setLoading(true);
    $('#language').disabled = true;
    button.disabled = true;
    button.textContent = t('启动中…');
    output.textContent = '';
    try {
        if (!crossOriginIsolated) {
            throw new Error(t('运行环境需要跨源隔离，请通过 localhost 或支持此能力的 HTTPS 入口打开。'));
        }
        status.textContent = t('正在启动浏览器内 Node.js…');
        progress.value = 5;
        container = await WebContainer.boot();
        const response = await fetch('/firekylin-files.json');
        if (!response.ok) throw new Error(t('缺少应用快照，请先运行 npm run build'));
        const files = await response.json();
        function hydrate(tree) {
            for (const entry of Object.values(tree)) {
                if (entry.directory) hydrate(entry.directory);
                else if (Array.isArray(entry.file.contents)) {
                    entry.file.contents = new Uint8Array(entry.file.contents);
                }
            }
        }
        hydrate(files);
        await container.mount(files);
        container.on('server-ready', async (port, url) => {
            if (port !== 8360) return;
            try {
                previewUrl = url.replace(/\/$/, '');
                await container.fs.writeFile('preview-url', previewUrl);
                const launch = JSON.parse(await container.fs.readFile('launch.json', 'utf-8'));
                const target = launch.loginToken
                    ? '/__playground/login?token=' + encodeURIComponent(launch.loginToken)
                    : launch.landingPage;
                previewTimer = setTimeout(() => {
                    if (!$('#empty').hidden) {
                        status.textContent = t('启动耗时较长，可查看日志了解进度。');
                    }
                }, 30000);
                $('iframe').src = previewUrl + target;
                $('iframe').hidden = false;

                $('#preview').href = previewUrl + launch.landingPage;
                $('#preview').hidden = false;
                $('#front').disabled = false;
                $('#admin').disabled = false;
                clearTimeout(startupTimer);
                progress.value = 100;
                status.textContent = t('站点已就绪 · 数据仅保留在本次体验中');
                $('#language').disabled = false;
                button.disabled = false;
                button.textContent = t('重新运行');
                runtimeReady = true;
                devtools.ready();
            } catch (error) {
                status.textContent = t('打开预览失败：') + error.message;
                setLoading(false);
                $('#language').disabled = false;
                button.disabled = false;
                button.textContent = t('重新运行');
            }
        });
        status.textContent = t('正在加载 Firekylin 运行环境…');
        const manifest = await fetch('/snapshots.json');
        if (!manifest.ok) throw new Error(t('缺少依赖快照，请先运行 npm run build'));
        const names = await manifest.json();
        for (const [index, name] of names.entries()) {
            const archive = await fetch('/snapshots/' + name + '.bin');
            if (!archive.ok) throw new Error(t('依赖快照读取失败：') + name);
            const mountPoint = '.store/' + name;
            await container.fs.mkdir(mountPoint, { recursive: true });
            await container.mount(await archive.arrayBuffer(), { mountPoint });
            progress.value = 10 + ((index + 1) / names.length) * 70;
            status.textContent = t('正在加载 Firekylin 运行环境…') + ` ${index + 1}/${names.length}`;
        }
        const links = await fetch('/dependency-links.json');
        if (!links.ok) throw new Error(t('缺少依赖链接文件'));
        await container.mount(await links.json());
        log(t('运行环境已加载，开始初始化站点。\n'));
        status.textContent = t('正在初始化站点…');
        const versionProcess = await container.spawn('node', ['--version']);
        let nodeVersion = '';
        const versionOutput = versionProcess.output.pipeTo(
            new WritableStream({
                write(chunk) {
                    nodeVersion += chunk;
                }
            })
        );
        await versionProcess.exit;
        await versionOutput;
        log('Node.js ' + nodeVersion.trim() + '\n');
        const process = await container.spawn('node', ['--max-old-space-size=512', 'start-playground.cjs'], {
            env: {NODE_ENV: 'production', PLAYGROUND_LOCALE: language(), PLAYGROUND_ORIGIN: location.origin}
        });
        startupTimer = setTimeout(() => {
            log(t('启动超过 180 秒，请查看日志并重新运行。\n'));
            process.kill();
        }, 180000);
        const stream = process.output.pipeTo(new WritableStream({ write: log }));
        const code = await process.exit;
        await stream;
        throw new Error(`Process exited (${code}). See Logs.`);
    } catch (error) {
        clearTimeout(startupTimer);
        stopLaunchSound();
        status.textContent = t('运行失败：') + error.message;
        log('\nERROR: ' + error.message + '\n');
        runtimeReady = false;
        setLoading(false);
        $('#language').disabled = false;
        $('iframe').hidden = true;
        $('#empty').hidden = false;
        container?.teardown();
        $('#front').disabled = true;
        $('#admin').disabled = true;
        $('#preview').hidden = true;
        button.disabled = false;
        button.textContent = t('重新运行');
        openPanel('logs-panel');
    }
}
button.addEventListener('click', start);
$('#launch').addEventListener('click', start);
$('#front').addEventListener('click', () => navigate('/'));
$('#admin').addEventListener('click', () => navigate('/admin'));
$('#share').addEventListener('click', async () => {
    try {
        const url = new URL(location.href);
        url.hash = '';
        url.searchParams.set('lang', language());
        await navigator.clipboard.writeText(url.href);
        message(t('分享链接已复制。对方打开后可启动自己的体验站点。'));
    } catch (error) {
        message(t('复制失败：') + error.message, true);
    }
});
function updateLaunchLabel() {
    const label = t(attempted ? '重新运行' : '启动 Firekylin');
    $('#launch').setAttribute('aria-label', label);
    $('#launch').title = label;
    $('#launch-label').textContent = t(attempted ? '重新运行' : '启动');
}
function setLoading(loading) {
    $('#empty').classList.toggle('is-loading', loading);
    $('#launch-idle').hidden = loading;
    $('#launch-loading').hidden = !loading;
    $('#launch').disabled = loading;
    $('main').setAttribute('aria-busy', String(loading));
    if (!loading && attempted) updateLaunchLabel();
}
function syncLoading() {
    const value = Math.min(99, Math.round(progress.value));
    $('#loading-detail').textContent = status.textContent;
    $('#loading-percent').textContent = value + '%';
    $('#loading-fill').style.width = value + '%';
    const stage = value < 10 ? 0 : value < 85 ? 1 : value < 97 ? 2 : 3;
    for (const item of document.querySelectorAll('[data-stage]')) {
        item.classList.toggle('active', Number(item.dataset.stage) === stage);
        item.classList.toggle('done', Number(item.dataset.stage) < stage);
    }
}
new MutationObserver(syncLoading).observe(status, { childList: true, characterData: true, subtree: true });
new MutationObserver(syncLoading).observe(progress, { attributes: true, attributeFilter: ['value'] });
$('iframe').addEventListener('load', () => {
    if (!runtimeReady) return;
    clearTimeout(previewTimer);
    $('#empty').hidden = true;
    setLoading(false);
});
let preferred = new URL(location.href).searchParams.get('lang');
try {
    preferred ||= localStorage.getItem('firekylin.playground.language');
} catch {
    /* Optional preference. */
}
if (!['zh-CN', 'en-US'].includes(preferred)) preferred = 'zh-CN';
translatePage(preferred);
$('#language').value = preferred;
$('#language').addEventListener('change', async (event) => {
    const next = event.target.value;
    const previous = language();
    event.target.disabled = true;
    try {
        if (runtimeReady) await devtools.setLocale(next);
        translatePage(next);
        try {
            localStorage.setItem('firekylin.playground.language', next);
        } catch {
            /* Optional preference. */
        }
        const url = new URL(location.href);
        url.searchParams.set('lang', next);
        history.replaceState(null, '', url);
        if (runtimeReady) {
            status.textContent = t('站点已就绪 · 数据仅保留在本次体验中');
            button.textContent = t('重新运行');
            navigate('/admin');
            devtools.ready();
        } else if (attempted) {
            button.textContent = t('重新运行');
            updateLaunchLabel();
        }
    } catch (error) {
        event.target.value = previous;
        message(t('语言切换失败：') + error.message, true);
    } finally {
        event.target.disabled = false;
    }
});
try {
    const restart = sessionStorage.getItem('firekylin-simple-autostart');
    sessionStorage.removeItem('firekylin-simple-autostart');
    if (restart === '1') start();
} catch {
    // A fresh site can still start when browser storage is unavailable.
}
