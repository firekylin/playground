const PostCommandService = require('./src/service/post-command');

module.exports = async function runBlueprint(blueprint, report = () => {}) {
    const actor = await think.model('user').where({ name: 'playground' }).find();
    const service = new PostCommandService({
        getModel: () => think.model('post'),
        now: () => think.datetime()
    });
    for (const [index, step] of blueprint.steps.entries()) {
        report({ phase: 'step', index, total: blueprint.steps.length, step: step.step });
        try {
            if (step.step === 'setSiteOptions') {
                for (const [key, value] of Object.entries(step.options)) {
                    const model = think.model('options');
                    const existing = await model.where({ key }).find();
                    if (existing.key) await model.where({ key }).update({ value });
                    else await model.add({ key, value });
                }
            } else if (step.step === 'activateTheme') {
                await think.model('options').where({ key: 'theme' }).update({ value: step.theme });
            } else if (step.step === 'createPost') {
                await service.create(
                    {
                        title: step.title,
                        pathname: step.pathname,
                        markdown_content: step.markdown,
                        status: step.status === 'published' ? firekylin.POST_PUBLISH : firekylin.POST_DRAFT,
                        is_public: firekylin.POST_PUBLIC,
                        allow_comment: firekylin.POST_ALLOW_COMMENT,
                        tag: step.tags || [],
                        options: '{}'
                    },
                    actor,
                    { getTagModel: () => think.model('tag') }
                );
            }
            report({ phase: 'step-complete', index });
        } catch (error) {
            throw new Error(`初始化第 ${index + 1} 步 ${step.step} 失败：${error.message}`, { cause: error });
        }
    }
    return actor;
};
