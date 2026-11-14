const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

async function main() {
    const locale = ['zh-CN', 'en-US'].includes(process.env.PLAYGROUND_LOCALE)
        ? process.env.PLAYGROUND_LOCALE : 'zh-CN';
    const port = Number(process.env.PLAYGROUND_PORT || 8360);
    const report = (event) => console.log('PLAYGROUND_EVENT ' + JSON.stringify(event));
    report({ phase: 'initializing' });
    const { PGlite } = await import('@electric-sql/pglite');
    const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
    const db = await PGlite.create();
    const socketDir = fs.mkdtempSync('/tmp/firekylin-pg-');
    const socket = new PGLiteSocketServer({
        db,
        path: path.join(socketDir, '.s.PGSQL.5439'),
        maxConnections: 4
    });
    await socket.start();
    console.log('PGlite ready');
    const project = path.join(__dirname, 'playground-site');
    fs.mkdirSync(project, { recursive: true });
    for (const dir of ['data/runtime', 'data/logs', 'uploads', 'plugins']) {
        fs.mkdirSync(path.join(project, dir), { recursive: true });
    }
    fs.cpSync(path.join(__dirname, 'www/theme'), path.join(project, 'themes'), { recursive: true });
    const config = {
        database: {
            type: 'postgresql',
            host: socketDir,
            port: 5439,
            user: 'postgres',
            database: 'postgres',
            prefix: 'fk_'
        },
        server: { port, host: '0.0.0.0', proxy: true }
    };
    fs.writeFileSync(
        path.join(project, 'firekylin.config.js'),
        'module.exports = ' + JSON.stringify(config, null, 2) + ';\n'
    );
    const commandDirectory = path.join(__dirname, 'node_modules', '.bin');
    fs.mkdirSync(commandDirectory, { recursive: true });
    const cliPath = path.join(commandDirectory, 'firekylin');
    if (!fs.existsSync(cliPath)) fs.symlinkSync('../../bin/firekylin.js', cliPath);
    fs.chmodSync(path.join(__dirname, 'bin/firekylin.js'), 0o755);
    fs.writeFileSync(
        path.join(__dirname, 'terminal-env.json'),
        JSON.stringify({
            PATH: commandDirectory + path.delimiter + process.env.PATH,
            FIREKYLIN_PROJECT_PATH: project
        })
    );
    process.env.FIREKYLIN_PROJECT_PATH = project;
    const { initialize } = require('./lib/installer');
    await initialize(project, config, {
        title: '我的 Firekylin 博客',
        siteUrl: `http://localhost:${port}`,
        username: 'playground',
        password: 'playground-demo',
        email: 'playground@example.invalid'
    });
    console.log('Firekylin database initialized');
    const Application = require('thinkjs');
    const Loader = require('thinkjs/lib/loader');
    const app = new Application({
        ROOT_PATH: __dirname,
        APP_PATH: path.join(__dirname, 'src'),
        RUNTIME_PATH: path.join(project, 'data/runtime'),
        proxy: true,
        env: 'production'
    });
    new Loader(app.options).loadAll('worker');
    await think.beforeStartServer();
    const localeOptions = think.model('options');
    const localeRow = await localeOptions.where({ key: 'locale' }).find();
    if (localeRow.key) await localeOptions.where({ key: 'locale' }).update({ value: locale });
    else await localeOptions.add({ key: 'locale', value: locale });
    report({phase: 'seeding'});
    const actor = await require('./seed-site.cjs')();
    let loginToken = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(
        path.join(__dirname, 'launch.json'),
        JSON.stringify({
            landingPage: '/admin',
            loginToken
        })
    );
    let configuredOrigin;
    const callback = think.app.callback();
    const server = http.createServer(async (req, res) => {
        try {
            const originFile = path.join(__dirname, 'preview-url');
            if (!configuredOrigin && fs.existsSync(originFile)) {
                configuredOrigin = new URL(fs.readFileSync(originFile, 'utf8')).origin;
                await think.model('options').where({ key: 'site_url' }).update({ value: configuredOrigin });
            }
            const requestUrl = new URL(req.url, 'http://localhost');
            if (requestUrl.pathname === '/__playground/login') {
                if (!loginToken || requestUrl.searchParams.get('token') !== loginToken) {
                    res.writeHead(410).end('This playground login link has expired.');
                    return;
                }
                loginToken = null;
                const options = await think.model('options').getOptions(true);
                const auth = require('./src/service/admin-auth');
                const token = auth.sign(actor, options.jwt_secret || options.comment_jwt_secret);
                // The HTTPS preview is embedded on another origin. Scope its session to that embedding site.
                const attributes = configuredOrigin?.startsWith('https:')
                    ? '; SameSite=None; Secure; Partitioned'
                    : '; SameSite=Lax';
                res.writeHead(303, {
                    'Set-Cookie': `thinkjs=${token}; Path=/; HttpOnly${attributes}`,
                    Location: '/admin',
                    'Cache-Control': 'no-store',
                    'Referrer-Policy': 'no-referrer'
                }).end();
                return;
            }
            callback(req, res);
        } catch (error) {
            console.error(error);
            res.writeHead(500).end('Playground initialization failed');
        }
    });
    think.app.server = server;
    server.listen(port, '0.0.0.0', () => {
        think.app.emit('appReady');
        report({ phase: 'ready' });
    });
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
