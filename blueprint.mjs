export const MAX_BLUEPRINT_BYTES = 256 * 1024;

function object(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
    for (const key of Object.keys(value)) {
        if (!keys.includes(key)) throw new Error(`${label}.${key} 尚不支持`);
    }
}
function string(value, label, max = 200) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
        throw new Error(`${label} 必须是 1–${max} 字符的文本`);
    }
}
export function validateBlueprint(input) {
    object(
        input,
        ['version', 'title', 'description', 'landingPage', 'login', 'steps', 'locale', 'runtime'],
        '配置'
    );
    if (input.version !== 1) throw new Error('仅支持配置版本 1');
    string(input.title, 'title');
    if (input.description !== undefined) string(input.description, 'description', 1000);
    if (input.login !== undefined && typeof input.login !== 'boolean') throw new Error('login 必须是布尔值');
    const locale = input.locale ?? 'zh-CN';
    if (!['zh-CN', 'en-US'].includes(locale)) throw new Error('语言只支持 zh-CN 和 en-US');
    const runtime = { mode: 'production', heapMB: 512, traceWarnings: false, env: {}, ...input.runtime };
    if (input.runtime !== undefined)
        object(input.runtime, ['mode', 'heapMB', 'traceWarnings', 'env'], 'runtime');
    if (!['production', 'development'].includes(runtime.mode)) throw new Error('运行模式无效');
    if (![256, 512, 1024, 2048].includes(runtime.heapMB)) throw new Error('Node.js 内存上限无效');
    if (typeof runtime.traceWarnings !== 'boolean') throw new Error('traceWarnings 必须是布尔值');
    if (
        !runtime.env ||
        typeof runtime.env !== 'object' ||
        Array.isArray(runtime.env) ||
        Object.keys(runtime.env).length > 32
    )
        throw new Error('环境变量必须是最多 32 项的对象');
    for (const [key, value] of Object.entries(runtime.env)) {
        if (
            !/^[A-Z][A-Z0-9_]{0,63}$/.test(key) ||
            /^(NODE_|FIREKYLIN_|FK_|PLAYGROUND_)/.test(key) ||
            ['PATH', 'HOME', 'HOST', 'PORT', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES'].includes(key)
        ) {
            throw new Error('环境变量名称无效或由运行环境管理：' + key);
        }
        if (typeof value !== 'string' || value.length > 2000)
            throw new Error('环境变量值必须是最多 2000 字符的文本');
    }
    const landingPage = input.landingPage ?? '/admin';
    if (
        typeof landingPage !== 'string' ||
        !/^\/(?!\/)[A-Za-z0-9_/?=&.#%-]*$/.test(landingPage) ||
        /%2f|%5c|%0[ad]/i.test(landingPage)
    ) {
        throw new Error('landingPage 必须是站内路径，例如 /admin 或 /');
    }
    if (!Array.isArray(input.steps) || input.steps.length > 50)
        throw new Error('steps 必须是最多 50 步的数组');
    const pathnames = new Set(['hello-world-via-firekylin']);
    input.steps.forEach((step, index) => {
        const label = `steps[${index}]`;
        if (step?.step === 'setSiteOptions') {
            object(step, ['step', 'options'], label);
            object(step.options, ['title', 'description'], `${label}.options`);
            for (const [key, value] of Object.entries(step.options))
                string(value, `${label}.options.${key}`, 1000);
        } else if (step?.step === 'createPost') {
            object(step, ['step', 'title', 'pathname', 'markdown', 'status', 'tags'], label);
            string(step.title, `${label}.title`);
            if (typeof step.pathname !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(step.pathname)) {
                throw new Error(`${label}.pathname 只能使用小写字母、数字和短横线`);
            }
            if (pathnames.has(step.pathname)) throw new Error(`${label}.pathname 重复：${step.pathname}`);
            pathnames.add(step.pathname);
            string(step.markdown, `${label}.markdown`, 50000);
            if (!['draft', 'published'].includes(step.status))
                throw new Error(`${label}.status 必须是 draft 或 published`);
            if (step.tags !== undefined) {
                if (!Array.isArray(step.tags) || step.tags.length > 10)
                    throw new Error(`${label}.tags 最多 10 个`);
                step.tags.forEach((tag) => string(tag, `${label}.tags`, 50));
            }
        } else if (step?.step === 'activateTheme') {
            object(step, ['step', 'theme'], label);
            if (step.theme !== 'firekylin') throw new Error('当前快照仅预装 firekylin 主题');
        } else {
            throw new Error(`${label}.step 不支持：${step?.step ?? '缺失'}`);
        }
    });
    return { ...input, locale, runtime, landingPage, login: input.login ?? true };
}
export function parseBlueprint(text) {
    if (new TextEncoder().encode(text).length > MAX_BLUEPRINT_BYTES)
        throw new Error('配置文件不能超过 256 KiB');
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        throw new Error('JSON 格式有误，请检查引号、逗号和括号');
    }
    return validateBlueprint(value);
}
export const presets = {
    writing: {
        version: 1,
        title: '开始写作',
        description: '从一篇草稿开始，体验 Markdown 编辑、预览和发布。',
        landingPage: '/admin',
        login: true,
        steps: [
            {
                step: 'setSiteOptions',
                options: { title: '我的 Firekylin 博客', description: '在浏览器里，写下你的第一个故事。' }
            },
            {
                step: 'createPost',
                title: '从这里开始写作',
                pathname: 'my-first-story',
                status: 'draft',
                markdown:
                    '# 你好，Firekylin\n\n这是一篇属于你的草稿。试试修改标题，写下内容，再点击发布。\n\n- Markdown 编辑\n- 实时预览\n- 一键发布',
                tags: ['写作']
            }
        ]
    },
    showcase: {
        version: 1,
        title: '浏览示例博客',
        description: '带着内容体验默认主题、文章和标签。',
        landingPage: '/',
        login: true,
        steps: [
            {
                step: 'setSiteOptions',
                options: { title: '日常的片刻', description: '记录想法，也记录生活。' }
            },
            { step: 'activateTheme', theme: 'firekylin' },
            {
                step: 'createPost',
                title: '把想法写下来',
                pathname: 'write-it-down',
                status: 'published',
                markdown:
                    '## 写作从一个念头开始\n\n不必等到一切准备就绪。打开编辑器，把今天的想法写下来。\n\n> 让记录成为日常。',
                tags: ['随笔']
            },
            {
                step: 'createPost',
                title: '一小段代码',
                pathname: 'a-small-function',
                status: 'published',
                markdown:
                    '用 Markdown 分享代码：\n\n```javascript\nfunction hello(name) {\n  return `你好，${name}`;\n}\n```',
                tags: ['技术', 'Markdown']
            }
        ]
    },
    blank: {
        version: 1,
        title: '基础站点',
        description: '仅保留 Firekylin 安装器的欢迎文章，自己探索。',
        landingPage: '/admin',
        login: true,
        steps: []
    }
};
