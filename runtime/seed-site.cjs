const PostCommandService = require("./src/service/post-command");

// Fixed demo content. This is not a configurable recipe or a second blog implementation.
module.exports = async function seedSite() {
  const actor = await think.model("user").where({ name: "playground" }).find();
  const options = think.model("options");
  await options.updateOptions({
    title: "我的 Firekylin 博客",
    description: "在浏览器里，写下你的第一个故事。",
    theme: "firekylin",
  });
  const service = new PostCommandService({
    getModel: () => think.model("post"),
    now: () => think.datetime(),
  });
  const posts = [
    {
      title: "从这里开始写作",
      pathname: "my-first-story",
      markdown_content:
        "# 你好，Firekylin\n\n这是一篇属于你的草稿。试试修改标题，写下内容，再点击发布。",
      status: firekylin.POST_DRAFT,
      tag: ["写作"],
    },
    {
      title: "把想法写下来",
      pathname: "write-it-down",
      markdown_content:
        "## 写作从一个念头开始\n\n不必等到一切准备就绪。\n\n> 让记录成为日常。",
      status: firekylin.POST_PUBLISH,
      tag: ["随笔"],
    },
  ];
  for (const post of posts) {
    await service.create(
      {
        ...post,
        is_public: firekylin.POST_PUBLIC,
        allow_comment: firekylin.POST_ALLOW_COMMENT,
        options: "{}",
      },
      actor,
      { getTagModel: () => think.model("tag") },
    );
  }
  return actor;
};
