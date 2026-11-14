import { t, language } from './i18n.mjs';
const SITE_DIRECTORY = 'playground-site';
const $ = (selector) => document.querySelector(selector);
const text = (tag, value) => {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
};
export function setupDevtools(getRuntime, notify) {
    let terminal;
    let fit;
    let shell;
    let shellInput;
    let currentTool;
    let databasePage;
    let offset = 0;
    let editingRow;
    let sort;
    let direction = 'asc';
    let rowInputs = [];
    let selectedFile;
    let originalText;
    let dbBusy = false;
    let terminalStart;
    function report(value) {
        $('#tool-status').textContent = value;
    }
    function action(selector, callback) {
        $(selector).addEventListener('click', async () => {
            try {
                await callback();
            } catch (error) {
                report(error.message);
                notify(error.message, true);
            }
        });
    }
    async function db(request) {
        if (dbBusy) throw new Error(t('数据库操作尚未完成'));
        const runtime = getRuntime();
        dbBusy = true;
        const filename = '.playground-request-' + crypto.randomUUID() + '.json';
        let timeout;
        try {
            await runtime.fs.writeFile(filename, JSON.stringify(request));
            const process = await runtime.spawn('node', ['db-tool.cjs', filename]);
            timeout = setTimeout(() => process.kill(), 20000);
            let output = '';
            const stream = process.output.pipeTo(
                new WritableStream({
                    write(chunk) {
                        output += chunk;
                    }
                })
            );
            const code = await process.exit;
            await stream;
            let response;
            try {
                response = JSON.parse(output.trim());
            } catch {
                throw new Error(t('数据库进程未返回结果：') + output.slice(-500));
            }
            if (code !== 0 || !response.ok) throw new Error(response.error || t('数据库操作失败'));
            return response.result;
        } finally {
            clearTimeout(timeout);
            dbBusy = false;
            await runtime.fs.rm(filename, { force: true }).catch(() => {});
        }
    }
    async function tables() {
        const previous = $('#db-table').value;
        const names = await db({ action: 'tables' });
        $('#db-table').replaceChildren(
            ...names.map((item) => {
                const option = text('option', item.table_name);
                option.value = item.table_name;
                return option;
            })
        );
        if (names.some((item) => item.table_name === previous)) $('#db-table').value = previous;
        offset = 0;
        if (!names.some((item) => item.table_name === previous)) sort = undefined;
        if (names.length) await browse();
        else {
            databasePage = undefined;
            $('#db-grid').replaceChildren(text('p', t('当前没有数据表。')));
            $('#db-insert').disabled = true;
            $('#db-prev').disabled = true;
            $('#db-next').disabled = true;
            $('#db-page').textContent = '';
        }
    }
    function openRow(row) {
        editingRow = {
            action: row ? 'update' : 'insert',
            table: $('#db-table').value,
            key: row ? Object.fromEntries(databasePage.primary.map((key) => [key, row[key]])) : undefined
        };
        $('#row-title').textContent = row ? t('编辑记录') : t('新增记录');
        rowInputs = databasePage.columns.map((column) => {
            const name = column.column_name;
            const wrapper = document.createElement('div');
            wrapper.className = 'db-field';
            const label = text('label', name + (databasePage.primary.includes(name) ? t(' · 主键') : ''));
            const input = document.createElement('textarea');
            input.rows = 2;
            input.id = 'db-field-' + rowInputs.length + '-' + name;
            label.htmlFor = input.id;
            const value = row?.[name];
            input.value =
                value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
            const mode = document.createElement('select');
            mode.setAttribute('aria-label', name + t(' 值类型'));
            const options = [['value', t('填写值')]];
            if (column.is_nullable === 'YES') options.push(['null', t('NULL（空值）')]);
            if (!row) options.push(['default', t('使用默认值')]);
            for (const [key, title] of options) {
                const option = text('option', title);
                option.value = key;
                mode.append(option);
            }
            const generated = column.is_generated !== 'NEVER' || column.is_identity === 'YES';
            mode.value = row ? (value === null ? 'null' : 'value') : 'default';
            mode.disabled = generated;
            input.disabled = generated || mode.value !== 'value';
            mode.addEventListener('change', () => {
                input.disabled = mode.value !== 'value';
            });
            const hint = text(
                'small',
                column.data_type +
                    (generated ? t(' · 自动生成') : '') +
                    (column.column_default ? t(' · 默认：') + column.column_default : '')
            );
            wrapper.append(label, hint, mode, input);
            return {
                wrapper,
                input,
                mode,
                column,
                generated,
                original: input.value,
                originalMode: mode.value
            };
        });
        $('#row-fields').replaceChildren(...rowInputs.map((field) => field.wrapper));
        $('#row-status').textContent = '';
        $('#row-panel').showModal();
    }
    async function browse() {
        const tableName = $('#db-table').value;
        if (!tableName) return;
        databasePage = await db({
            action: 'browse',
            table: tableName,
            offset,
            sort,
            direction,
            search: $('#db-search').value
        });
        if (offset && offset >= databasePage.total) {
            offset = Math.max(0, Math.ceil(databasePage.total / 100) - 1) * 100;
            return browse();
        }
        const table = document.createElement('table');
        const head = document.createElement('tr');
        head.append(text('th', t('操作')));
        for (const column of databasePage.columns) {
            const th = document.createElement('th');
            const button = text(
                'button',
                column.column_name +
                    (sort === column.column_name ? (direction === 'asc' ? ' ↑' : ' ↓') : ' ↕')
            );
            button.title =
                column.data_type + (databasePage.primary.includes(column.column_name) ? t(' · 主键') : '');
            button.addEventListener('click', () => {
                direction = sort === column.column_name && direction === 'asc' ? 'desc' : 'asc';
                sort = column.column_name;
                offset = 0;
                browse().catch((error) => report(error.message));
            });
            th.append(button);
            head.append(th);
        }
        const thead = document.createElement('thead');
        thead.append(head);
        const body = document.createElement('tbody');
        for (const row of databasePage.rows) {
            const line = document.createElement('tr');
            const cell = document.createElement('td');
            const edit = text('button', t('编辑'));
            edit.disabled = !databasePage.primary.length;
            edit.title = edit.disabled ? t('此表没有主键，无法准确定位记录') : t('按字段编辑此记录');
            edit.addEventListener('click', () => openRow(row));
            const remove = text('button', t('删除'));
            remove.disabled = edit.disabled;
            remove.addEventListener('click', async () => {
                const key = Object.fromEntries(databasePage.primary.map((name) => [name, row[name]]));
                if (
                    !confirm(
                        t('删除 ') +
                            tableName +
                            t(' 中的记录 ') +
                            JSON.stringify(key) +
                            t('？此操作不可撤销。')
                    )
                )
                    return;
                remove.disabled = true;
                try {
                    await db({ action: 'delete', table: tableName, key });
                    await browse();
                } catch (error) {
                    report(error.message);
                    remove.disabled = false;
                }
            });
            cell.append(edit, remove);
            line.append(
                cell,
                ...databasePage.columns.map((column) => {
                    const value = row[column.column_name];
                    const content =
                        value === null
                            ? 'NULL'
                            : typeof value === 'object'
                              ? JSON.stringify(value)
                              : String(value);
                    const td = text('td', content);
                    td.title = content;
                    if (value === null) td.className = 'db-null';
                    return td;
                })
            );
            body.append(line);
        }
        table.append(thead, body);
        $('#db-grid').replaceChildren(table);
        if (!databasePage.rows.length)
            $('#db-grid').append(text('p', t('没有匹配的记录，可调整筛选或新增记录。')));
        $('#db-insert').disabled = false;
        $('#db-page').textContent =
            language() === 'en-US'
                ? `${databasePage.total} rows · Page ${offset / 100 + 1}/${Math.max(1, Math.ceil(databasePage.total / 100))}`
                : `共 ${databasePage.total} 条 · 第 ${offset / 100 + 1}/${Math.max(1, Math.ceil(databasePage.total / 100))} 页`;
        $('#db-prev').disabled = offset === 0;
        $('#db-next').disabled = offset + 100 >= databasePage.total;
        report(
            databasePage.primary.length
                ? t('点击列名排序，使用「编辑」按字段修改数据。')
                : t('此表无主键，可浏览和新增；修改或删除请使用 SQL。')
        );
    }
    action('#db-insert', () => openRow());
    $('#db-filter').addEventListener('submit', (event) => {
        event.preventDefault();
        offset = 0;
        browse().catch((error) => report(error.message));
    });
    action('#db-refresh', tables);
    $('#db-table').addEventListener('change', () => {
        sort = undefined;
        $('#db-search').value = '';
        offset = 0;
        browse().catch((error) => report(error.message));
    });
    action('#db-prev', async () => {
        offset = Math.max(0, offset - 100);
        await browse();
    });
    action('#db-next', async () => {
        offset += 100;
        await browse();
    });
    action('#row-save', async () => {
        try {
            const changes = {};
            for (const field of rowInputs) {
                const { column, input, mode, generated, original, originalMode } = field;
                if (generated || mode.value === 'default') continue;
                if (editingRow.action === 'update' && input.value === original && mode.value === originalMode)
                    continue;
                let value = mode.value === 'null' ? null : input.value;
                if (value !== null && ['json', 'jsonb', 'ARRAY'].includes(column.data_type)) {
                    try {
                        const parsed = JSON.parse(value);
                        value = column.data_type === 'ARRAY' ? parsed : JSON.stringify(parsed);
                    } catch {
                        throw new Error(column.column_name + t(' 需要有效 JSON'));
                    }
                }
                changes[column.column_name] = value;
            }
            if (editingRow.action === 'update' && !Object.keys(changes).length) {
                $('#row-panel').close();
                return;
            }
            $('#row-save').disabled = true;
            await db({ ...editingRow, changes });
            $('#row-panel').close();
            await browse();
        } catch (error) {
            $('#row-status').textContent = error.message;
        } finally {
            $('#row-save').disabled = false;
        }
    });
    action('#db-execute', async () => {
        $('#db-execute').disabled = true;
        try {
            const result = await db({ action: 'sql', sql: $('#db-sql').value });
            $('#db-result').textContent = JSON.stringify(result, null, 2);
            await tables();
        } catch (error) {
            $('#db-result').textContent = error.message;
        } finally {
            $('#db-execute').disabled = false;
        }
    });

    async function startTerminal() {
        const runtime = getRuntime();
        if (shell) {
            requestAnimationFrame(() => {
                fit.fit();
                terminal.focus();
            });
            return;
        }
        if (!terminal) {
            const [{ Terminal }, { FitAddon }] = await Promise.all([
                import('./vendor/xterm.mjs'),
                import('./vendor/fit.mjs')
            ]);
            terminal = new Terminal({
                fontSize: 12,
                cursorBlink: true,
                scrollback: 3000,
                theme: { background: '#15191f', foreground: '#dce1e8' }
            });
            fit = new FitAddon();
            terminal.loadAddon(fit);
            terminal.open($('#terminal'));
            terminal.onData((data) => {
                shellInput?.write(data).catch((error) => report(error.message));
            });
            new ResizeObserver(() => {
                if (currentTool === 'terminal' && !$('#devtools').hidden) {
                    fit.fit();
                    shell?.resize({ cols: terminal.cols, rows: terminal.rows });
                }
            }).observe($('#terminal'));
        }
        fit.fit();
        const terminalEnv = JSON.parse(await runtime.fs.readFile('terminal-env.json', 'utf8'));
        shell = await runtime.spawn('jsh', {
            cwd: SITE_DIRECTORY,
            env: terminalEnv,
            terminal: { cols: terminal.cols, rows: terminal.rows }
        });
        terminal.writeln('Firekylin CLI：firekylin --help · firekylin --version · firekylin plugin <name>');
        terminal.writeln(t('站点已在运行；文件编辑请使用 Files。此环境未提供 Vim。'));
        const process = shell;
        shellInput = process.input.getWriter();
        process.output
            .pipeTo(new WritableStream({ write: (chunk) => terminal.write(chunk) }))
            .catch((error) => report(error.message));
        process.exit.then((code) => {
            if (shell !== process) return;
            shell = null;
            shellInput?.releaseLock();
            shellInput = null;
            terminal.writeln(t('\r\n终端已退出（') + code + t('），可点击重启终端。'));
        });
        terminal.focus();
        report(
            t(
                '当前目录为 Firekylin 站点：data、themes、plugins、uploads 和 firekylin.config.js；启动输出请查看运行日志。'
            )
        );
    }
    function ensureTerminal() {
        if (!terminalStart)
            terminalStart = startTerminal().finally(() => {
                terminalStart = null;
            });
        return terminalStart;
    }
    action('#terminal-restart', async () => {
        if (shell) {
            const process = shell;
            process.kill();
            await process.exit;
        }
        await ensureTerminal();
    });
    action('#terminal-clear', () => terminal?.clear());

    function directory() {
        return $('#file-path').value.trim() || '.';
    }
    function filename(name) {
        if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name))
            throw new Error(t('请输入不含路径分隔符的名称'));
        return directory().replace(/\/$/, '') + '/' + name;
    }
    function allowDiscard() {
        return (
            originalText === undefined ||
            $('#file-content').value === originalText ||
            confirm(t('放弃尚未保存的文件修改？'))
        );
    }
    async function openFile(file) {
        if (!allowDiscard()) return;
        const data = await getRuntime().fs.readFile(file);
        selectedFile = file;
        originalText = undefined;
        $('#file-selected').textContent = file + ' · ' + data.length + ' bytes';
        $('#file-download').disabled = false;
        $('#file-save').disabled = true;
        $('#file-content').disabled = true;
        if (data.length > 1024 * 1024 || data.includes(0)) {
            $('#file-content').value = t('二进制文件或超过 1 MiB，请下载后查看。');
            return;
        }
        try {
            originalText = new TextDecoder('utf-8', { fatal: true }).decode(data);
            $('#file-content').value = originalText;
            $('#file-content').disabled = false;
            $('#file-save').disabled = false;
        } catch {
            $('#file-content').value = t('非 UTF-8 文本，请下载后查看。');
        }
    }
    async function listFiles() {
        const runtime = getRuntime();
        const entries = await runtime.fs.readdir(directory(), { withFileTypes: true });
        entries.sort(
            (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
        );
        $('#file-list').replaceChildren(
            ...entries.map((entry) => {
                const item = document.createElement('li');
                const open = text('button', (entry.isDirectory() ? '▸ ' : '') + entry.name);
                open.addEventListener('click', async () => {
                    try {
                        const file = filename(entry.name);
                        if (entry.isDirectory()) {
                            $('#file-path').value = file;
                            await listFiles();
                        } else await openFile(file);
                    } catch (error) {
                        report(error.message);
                    }
                });
                const rename = text('button', t('重命名'));
                rename.addEventListener('click', async () => {
                    try {
                        const name = prompt(t('新名称'), entry.name);
                        if (!name || name === entry.name) return;
                        const target = filename(name);
                        if ((await runtime.fs.readdir(directory())).includes(name))
                            throw new Error(t('同名文件已存在'));
                        const source = filename(entry.name);
                        if (selectedFile === source && !allowDiscard()) return;
                        await runtime.fs.rename(source, target);
                        if (selectedFile === source || selectedFile?.startsWith(source + '/')) {
                            selectedFile = target + selectedFile.slice(source.length);
                            $('#file-selected').textContent = target;
                        }
                        await listFiles();
                    } catch (error) {
                        report(error.message);
                    }
                });
                const remove = text('button', t('删除'));
                remove.addEventListener('click', async () => {
                    try {
                        const target = filename(entry.name);
                        if (
                            !confirm(
                                t('删除 ') + target + (entry.isDirectory() ? t(' 及其全部内容？') : '？')
                            )
                        )
                            return;
                        await runtime.fs.rm(target, { recursive: entry.isDirectory() });
                        if (selectedFile === target || selectedFile?.startsWith(target + '/')) {
                            selectedFile = undefined;
                            originalText = undefined;
                            $('#file-content').value = '';
                            $('#file-content').disabled = true;
                            $('#file-save').disabled = true;
                            $('#file-download').disabled = true;
                            $('#file-selected').textContent = t('选择文件进行编辑');
                        }
                        await listFiles();
                    } catch (error) {
                        report(error.message);
                    }
                });
                item.append(open, rename, remove);
                return item;
            })
        );
        report(t('文件位于当前 WebContainer。保存后刷新预览；服务端代码可能需要在终端重启进程。'));
    }
    $('#file-path-form').addEventListener('submit', (event) => {
        event.preventDefault();
        listFiles().catch((error) => report(error.message));
    });
    action('#files-refresh', listFiles);
    action('#files-site', async () => {
        $('#file-path').value = SITE_DIRECTORY;
        await listFiles();
    });
    action('#files-up', async () => {
        if (directory().replace(/\/$/, '') === SITE_DIRECTORY) return;
        const parts = directory()
            .split('/')
            .filter((part) => part && part !== '.');
        parts.pop();
        $('#file-path').value = parts.join('/') || '.';
        await listFiles();
    });
    async function create(isDirectory) {
        const name = $('#file-new-name').value.trim();
        const target = filename(name);
        const runtime = getRuntime();
        if ((await runtime.fs.readdir(directory())).includes(name)) throw new Error(t('同名文件已存在'));
        if (isDirectory) await runtime.fs.mkdir(target);
        else await runtime.fs.writeFile(target, '');
        $('#file-new-name').value = '';
        await listFiles();
        if (!isDirectory) await openFile(target);
    }
    action('#file-create', () => create(false));
    action('#folder-create', () => create(true));
    action('#file-save', async () => {
        if (!selectedFile) return;
        await getRuntime().fs.writeFile(selectedFile, $('#file-content').value);
        originalText = $('#file-content').value;
        report(t('已保存：') + selectedFile);
    });
    action('#file-download', async () => {
        if (!selectedFile) return;
        download(await getRuntime().fs.readFile(selectedFile), selectedFile.split('/').pop());
    });
    action('#file-upload', () => {
        getRuntime();
        $('#file-upload-input').click();
    });
    $('#file-upload-input').addEventListener('change', async (event) => {
        try {
            for (const file of event.target.files) {
                if (file.size > 20 * 1024 * 1024) throw new Error(t('单个上传文件不能超过 20 MiB'));
                const target = filename(file.name);
                const runtime = getRuntime();
                if (
                    (await runtime.fs.readdir(directory())).includes(file.name) &&
                    !confirm(t('覆盖 ') + file.name + '？')
                )
                    continue;
                await runtime.fs.writeFile(target, new Uint8Array(await file.arrayBuffer()));
            }
            await listFiles();
        } catch (error) {
            report(error.message);
        }
        event.target.value = '';
    });
    async function show(name) {
        currentTool = name;
        $('#devtools').hidden = false;
        document.body.classList.add('tools-open');
        for (const type of ['database', 'terminal', 'files']) $('#tool-' + type).hidden = name !== type;
        for (const tab of document.querySelectorAll('[data-tool]'))
            tab.setAttribute('aria-pressed', String(tab.dataset.tool === name));
        try {
            getRuntime();
            if (name === 'database') await tables();
            if (name === 'terminal') await ensureTerminal();
            if (name === 'files') await listFiles();
        } catch (error) {
            report(error.message);
        }
    }
    for (const tab of document.querySelectorAll('[data-tool]'))
        tab.addEventListener('click', () => show(tab.dataset.tool));
    $('#close-devtools').addEventListener('click', () => {
        $('#devtools').hidden = true;
        document.body.classList.remove('tools-open');
    });
    return {
        async setLocale(locale) {
            await db({ action: 'locale', locale });
        },
        ready() {
            if (currentTool && !$('#devtools').hidden) show(currentTool);
        }
    };
}
export function download(data, name) {
    const url = URL.createObjectURL(new Blob([data]));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
