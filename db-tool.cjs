const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { Client } = createRequire(require.resolve('think-model-postgresql'))('pg');
const quote = (value) => '"' + String(value).replace(/"/g, '""') + '"';

async function execute(request, database) {
    const client = new Client({ ...database, connectionTimeoutMillis: 10000, query_timeout: 15000 });
    await client.connect();
    try {
        await client.query("SET statement_timeout = '10s'");
        if (request.action === 'locale') {
            if (!['zh-CN', 'en-US'].includes(request.locale)) throw new Error('Unsupported locale');
            const table = quote((database.prefix || 'fk_') + 'options');
            await client.query(
                'INSERT INTO ' +
                    table +
                    ' (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
                ['locale', request.locale]
            );
            return { locale: request.locale };
        }
        if (request.action === 'tables') {
            return (
                await client.query(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"
                )
            ).rows;
        }
        if (['browse', 'update', 'insert', 'delete'].includes(request.action)) {
            const table = request.table;
            const exists = await client.query(
                "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
                [table]
            );
            if (!exists.rows.length) throw new Error('数据表不存在');
            const columns = (
                await client.query(
                    "SELECT column_name, data_type, is_nullable, column_default, is_identity, is_generated FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
                    [table]
                )
            ).rows;
            const primary = (
                await client.query(
                    `SELECT a.attname FROM pg_index i
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
        WHERE i.indrelid=$1::regclass AND i.indisprimary`,
                    ['public.' + quote(table)]
                )
            ).rows.map((row) => row.attname);
            if (request.action === 'browse') {
                const offset = Math.max(0, Math.floor(Number(request.offset) || 0));
                const params = [];
                let filter = '';
                if (request.search) {
                    params.push('%' + String(request.search).slice(0, 1000) + '%');
                    filter =
                        ' WHERE (' +
                        columns.map((column) => quote(column.column_name) + '::text ILIKE $1').join(' OR ') +
                        ')';
                }
                let order = primary.length ? ' ORDER BY ' + primary.map(quote).join(', ') : '';
                if (request.sort) {
                    if (!columns.some((column) => column.column_name === request.sort))
                        throw new Error('无效排序字段');
                    order =
                        ' ORDER BY ' +
                        quote(request.sort) +
                        (request.direction === 'desc' ? ' DESC' : ' ASC');
                    const remaining = primary.filter((key) => key !== request.sort);
                    if (remaining.length) order += ', ' + remaining.map(quote).join(', ');
                }
                const from = ' FROM public.' + quote(table) + filter;
                const total = Number(
                    (await client.query('SELECT COUNT(*) AS total' + from, params)).rows[0].total
                );
                params.push(offset);
                const rows = (
                    await client.query(
                        'SELECT *' + from + order + ' LIMIT 100 OFFSET $' + params.length,
                        params
                    )
                ).rows;
                return { columns, primary, rows, offset, total };
            }
            if (request.action === 'insert') {
                const changes = request.changes;
                if (!changes || typeof changes !== 'object' || Array.isArray(changes))
                    throw new Error('字段值无效');
                const keys = Object.keys(changes);
                if (
                    keys.some(
                        (key) =>
                            !columns.some(
                                (column) =>
                                    column.column_name === key &&
                                    column.is_generated === 'NEVER' &&
                                    column.is_identity !== 'YES'
                            )
                    )
                )
                    throw new Error('包含无效或自动生成字段');
                const sql = keys.length
                    ? ' (' +
                      keys.map(quote).join(', ') +
                      ') VALUES (' +
                      keys.map((key, i) => '$' + (i + 1)).join(', ') +
                      ')'
                    : ' DEFAULT VALUES';
                return (
                    await client.query(
                        'INSERT INTO public.' + quote(table) + sql + ' RETURNING *',
                        keys.map((key) => changes[key])
                    )
                ).rows[0];
            }
            if (request.action === 'delete') {
                if (
                    !primary.length ||
                    !request.key ||
                    primary.some((key) => request.key[key] === undefined || request.key[key] === null)
                )
                    throw new Error('缺少主键');
                const where = primary.map((key, i) => quote(key) + '=$' + (i + 1)).join(' AND ');
                const result = await client.query(
                    'DELETE FROM public.' + quote(table) + ' WHERE ' + where,
                    primary.map((key) => request.key[key])
                );
                if (result.rowCount !== 1) throw new Error('记录已不存在，请刷新');
                return { deleted: result.rowCount };
            }
            if (!primary.length) throw new Error('此表没有主键，请使用 SQL 编辑');
            const changes = request.changes;
            if (!changes || typeof changes !== 'object' || Array.isArray(changes))
                throw new Error('行数据必须是 JSON 对象');
            if (!request.key || primary.some((key) => request.key[key] === undefined))
                throw new Error('缺少主键');
            const keys = Object.keys(changes);
            if (!keys.length || keys.some((key) => !columns.some((column) => column.column_name === key)))
                throw new Error('包含无效字段');
            const params = keys.map((key) => changes[key]);
            const set = keys.map((key, i) => quote(key) + '=$' + (i + 1)).join(', ');
            const where = primary
                .map((key) => {
                    params.push(request.key[key]);
                    return quote(key) + '=$' + params.length;
                })
                .join(' AND ');
            const result = await client.query(
                'UPDATE public.' + quote(table) + ' SET ' + set + ' WHERE ' + where + ' RETURNING *',
                params
            );
            if (result.rowCount !== 1) throw new Error('记录已不存在，请刷新');
            return result.rows[0];
        }
        if (request.action === 'sql') {
            if (typeof request.sql !== 'string' || !request.sql.trim() || request.sql.length > 50000)
                throw new Error('SQL 长度无效');
            const result = await client.query(request.sql);
            return (Array.isArray(result) ? result : [result]).map((item) => ({
                command: item.command,
                rowCount: item.rowCount,
                rows: item.rows.slice(0, 500),
                truncated: item.rows.length > 500
            }));
        }
        throw new Error('未知数据库操作');
    } finally {
        await client.end();
    }
}
module.exports = { execute };
if (require.main === module) {
    const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const { database } = require(path.join(__dirname, 'playground-site/firekylin.config.js'));
    execute(request, database)
        .then((result) => {
            console.log(JSON.stringify({ ok: true, result }));
        })
        .catch((error) => {
            console.log(JSON.stringify({ ok: false, error: error.message }));
            process.exitCode = 1;
        });
}
