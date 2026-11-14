import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { decode } = require('@msgpack/msgpack');
const here = new URL('../dist/', import.meta.url);
async function writeTree(tree, directory, compact = false) {
    await fs.mkdir(directory, { recursive: true });
    for (const [name, entry] of Object.entries(tree)) {
        const file = path.join(directory, name);
        const child = compact ? entry.d : entry.directory;
        if (child) await writeTree(child, file, compact);
        else if (entry.file?.symlink) await fs.symlink(entry.file.symlink, file);
        else {
            const contents = compact ? entry.f.c : entry.file.contents;
            await fs.writeFile(file, Array.isArray(contents) ? Buffer.from(contents) : contents);
        }
    }
}

test('real Firekylin seeds a demo site and consumes a one-time login link', { timeout: 180000 }, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'firekylin-playground-test-'));
    let child;
    try {
        await writeTree(JSON.parse(await fs.readFile(new URL('firekylin-files.json', here))), dir);
        const names = JSON.parse(await fs.readFile(new URL('snapshots.json', here)));
        for (const name of names) {
            const data = decode(await fs.readFile(new URL(`snapshots/${name}.bin`, here)));
            await writeTree(data.d, path.join(dir, '.store', name), true);
        }
        await writeTree(JSON.parse(await fs.readFile(new URL('dependency-links.json', here))), dir);
        const reservation = net.createServer();
        reservation.listen(0, '127.0.0.1');
        await once(reservation, 'listening');
        const port = reservation.address().port;
        await new Promise((resolve) => reservation.close(resolve));
        child = spawn(process.execPath, ['start-playground.cjs'], {
            cwd: dir,
            env: { ...process.env, PLAYGROUND_PORT: String(port), PLAYGROUND_LOCALE: 'en-US' },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let logs = '';
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('startup timeout\n' + logs)), 90000);
            child.stderr.on('data', (data) => {
                logs += data;
            });
            child.stdout.on('data', (data) => {
                logs += data;
                if (logs.includes('"phase":"ready"')) {
                    clearTimeout(timer);
                    resolve();
                }
            });
            child.once('exit', (code) => {
                clearTimeout(timer);
                reject(new Error(`exited ${code}\n${logs}`));
            });
        });
        const base = `http://127.0.0.1:${port}`;
        const front = await fetch(base);
        assert.equal(front.status, 200);
        const html = await front.text();
        assert.match(html, /我的 Firekylin 博客/);
        assert.match(html, /把想法写下来/);
        assert.doesNotMatch(html, /从这里开始写作/);
        const article = await fetch(base + '/post/write-it-down.html');
        assert.match(await article.text(), /让记录成为日常/);
        const launch = JSON.parse(await fs.readFile(path.join(dir, 'launch.json')));
        const loginUrl = base + '/__playground/login?token=' + launch.loginToken;
        await fs.writeFile(path.join(dir, 'preview-url'), 'https://preview.example.invalid');
        const login = await fetch(loginUrl, { redirect: 'manual' });
        assert.equal(login.status, 303);
        assert.equal(login.headers.get('location'), '/admin');
        assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=None; Secure; Partitioned/);
        const cookie = login.headers
            .getSetCookie()
            .map((value) => value.split(';')[0])
            .join('; ');
        assert.match(cookie, /thinkjs=/);
        assert.equal((await fetch(loginUrl, { redirect: 'manual' })).status, 410);
        const headers = { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' };
        const posts = await (await fetch(base + '/admin/api/post', { headers })).json();
        assert.equal(posts.errno, 0);
        assert.match(JSON.stringify(posts), /从这里开始写作/);
        assert.match(JSON.stringify(posts), /写作/);
        const unauthorized = await (
            await fetch(base + '/admin/api/post', {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            })
        ).json();
        assert.notEqual(unauthorized.errno, 0);
        const siteRequire = createRequire(path.join(dir, 'package.json'));
        const { execute } = siteRequire('./db-tool.cjs');
        const { database } = siteRequire('./playground-site/firekylin.config.js');
        const siteDirectory = path.join(dir, 'playground-site');
        for (const name of ['data', 'themes', 'plugins', 'uploads']) {
            assert.ok((await fs.stat(path.join(siteDirectory, name))).isDirectory());
        }
        assert.equal(database.host.startsWith('/tmp/firekylin-pg-'), true);
        const siteProcess = spawn(
            process.execPath,
            [
                '-e',
                'console.log(JSON.stringify({cwd: process.cwd(), config: require("./firekylin.config.js").database.type}))'
            ],
            { cwd: siteDirectory }
        );
        let siteOutput = '';
        siteProcess.stdout.on('data', (chunk) => {
            siteOutput += chunk;
        });
        const [siteExit] = await once(siteProcess, 'exit');
        assert.equal(siteExit, 0);
        assert.equal(JSON.parse(siteOutput).config, 'postgresql');
        assert.equal(await fs.realpath(JSON.parse(siteOutput).cwd), await fs.realpath(siteDirectory));
        const terminalEnv = JSON.parse(await fs.readFile(path.join(dir, 'terminal-env.json'), 'utf8'));
        async function cli(args) {
            const command = spawn('firekylin', args, {
                cwd: siteDirectory,
                env: { ...process.env, ...terminalEnv }
            });
            let output = '';
            command.stdout.on('data', (chunk) => {
                output += chunk;
            });
            command.stderr.on('data', (chunk) => {
                output += chunk;
            });
            const [code] = await once(command, 'exit');
            assert.equal(code, 0, output);
            return output;
        }
        assert.match(await cli(['--help']), /firekylin plugin/);
        assert.match(await cli(['--version']), /\d+\.\d+\.\d+/);
        assert.match(await cli(['plugin', 'terminal-demo']), /插件已创建/);
        assert.ok((await fs.stat(path.join(siteDirectory, 'plugins/terminal-demo'))).isDirectory());
        const pluginConfig = await fs.readFile(path.join(siteDirectory, 'firekylin.config.js'), 'utf8');
        assert.match(pluginConfig, /terminal-demo/);
        await execute({ action: 'locale', locale: 'zh-CN' }, database);
        assert.equal((await (await fetch(base + '/admin/locale')).json()).locale, 'zh-CN');
        await execute({ action: 'locale', locale: 'en-US' }, database);
        assert.equal((await (await fetch(base + '/admin/locale')).json()).locale, 'en-US');
        await assert.rejects(
            execute({ action: 'locale', locale: 'invalid' }, database),
            /Unsupported locale/
        );
        const tables = await execute({ action: 'tables' }, database);
        assert.ok(tables.some((row) => row.table_name === 'fk_post'));
        const page = await execute({ action: 'browse', table: 'fk_options' }, database);
        assert.ok(page.primary.includes('key'));
        const locale = await execute(
            { action: 'sql', sql: "SELECT value FROM fk_options WHERE key='locale'" },
            database
        );
        assert.equal(locale[0].rows[0].value, 'en-US');
        const changed = await execute(
            {
                action: 'update',
                table: 'fk_options',
                key: { key: 'description' },
                changes: { value: 'Changed through database tools' }
            },
            database
        );
        assert.equal(changed.value, 'Changed through database tools');
        await execute(
            { action: 'sql', sql: 'CREATE TABLE tool_test (id integer PRIMARY KEY, label text)' },
            database
        );
        await execute({ action: 'sql', sql: "INSERT INTO tool_test VALUES (1, 'before')" }, database);
        await execute(
            { action: 'update', table: 'tool_test', key: { id: 1 }, changes: { label: "after ' quote" } },
            database
        );
        const updated = await execute({ action: 'browse', table: 'tool_test' }, database);
        assert.equal(updated.rows[0].label, "after ' quote");
        await assert.rejects(execute({ action: 'sql', sql: 'not valid sql' }, database));
        const healthy = await execute({ action: 'sql', sql: 'SELECT 1 AS alive' }, database);
        assert.equal(healthy[0].rows[0].alive, 1);
        await assert.rejects(
            execute(
                { action: 'update', table: 'tool_test', key: { id: 99 }, changes: { label: 'missing' } },
                database
            ),
            /不存在/
        );
        await execute(
            {
                action: 'sql',
                sql: "CREATE TABLE visual_test (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, title text DEFAULT 'untitled', extra jsonb, enabled boolean DEFAULT true)"
            },
            database
        );
        const added = await execute(
            {
                action: 'insert',
                table: 'visual_test',
                changes: { title: "O'Reilly", extra: '{"hello":"你好"}' }
            },
            database
        );
        assert.equal(added.title, "O'Reilly");
        assert.equal(added.extra.hello, '你好');
        assert.equal(added.enabled, true);
        const defaults = await execute({ action: 'insert', table: 'visual_test', changes: {} }, database);
        assert.equal(defaults.title, 'untitled');
        const filtered = await execute(
            { action: 'browse', table: 'visual_test', search: "O'Reilly", sort: 'id', direction: 'desc' },
            database
        );
        assert.equal(filtered.total, 1);
        assert.equal(filtered.rows[0].id, added.id);
        assert.equal(filtered.columns.find((column) => column.column_name === 'id').is_identity, 'YES');
        const sorted = await execute(
            { action: 'browse', table: 'visual_test', sort: 'id', direction: 'desc' },
            database
        );
        assert.equal(sorted.rows[0].id, defaults.id);
        await execute(
            {
                action: 'update',
                table: 'visual_test',
                key: { id: added.id },
                changes: { title: null, extra: '"a string"', enabled: 'false' }
            },
            database
        );
        const updatedVisual = await execute({ action: 'browse', table: 'visual_test', sort: 'id' }, database);
        assert.equal(updatedVisual.rows[0].title, null);
        assert.equal(updatedVisual.rows[0].extra, 'a string');
        assert.equal(updatedVisual.rows[0].enabled, false);
        await assert.rejects(
            execute({ action: 'browse', table: 'visual_test', sort: 'id; DROP TABLE visual_test' }, database),
            /排序/
        );
        await assert.rejects(
            execute({ action: 'insert', table: 'visual_test', changes: { unknown: 'value' } }, database),
            /字段/
        );
        await assert.rejects(execute({ action: 'delete', table: 'visual_test', key: {} }, database), /主键/);
        assert.equal(
            (await execute({ action: 'delete', table: 'visual_test', key: { id: added.id } }, database))
                .deleted,
            1
        );
        const remaining = await execute({ action: 'browse', table: 'visual_test' }, database);
        assert.equal(remaining.total, 1);
        assert.equal(remaining.rows[0].id, defaults.id);
    } finally {
        if (child && child.exitCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
        }
        await fs.rm(dir, { recursive: true, force: true });
    }
});
