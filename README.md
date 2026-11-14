# Firekylin Playground

在浏览器里运行临时 Firekylin 站点。Node.js 由 WebContainers 提供，数据库使用 PGlite；预览服务器仅分发静态文件，不在服务器运行用户的博客。

## 开始使用

需要 Node.js 24.15+ LTS 或 26+、npm、Git，以及首次构建时的网络连接：

```sh
npm ci --ignore-scripts
npm run build
npm start
```

打开 http://localhost:4178，点击中央启动按钮。演示账号为 `playground`，密码为 `playground-demo`，默认自动登录。

## 功能

- 网站、后台预览与分享链接。
- 简体中文和英文界面；切换同步到运行中的后台。
- 实际加载进度、官网 Logo 动画和点击启动时的短音效。
- Database：表格浏览、分页、搜索、排序、记录增删改及 SQL。
- Terminal：站点目录中的交互式 shell，包含 `firekylin --help`、`firekylin --version`、`firekylin plugin <name>`。
- Files：文件浏览、编辑、新建、重命名、删除、上传和下载。
- 运行日志、临时账号说明。

刷新或重新运行会重建数据库和文件。分享的是体验入口，不是运行数据。语言选择在本浏览器保存。

## 独立边界

本仓库只维护 Playground 的界面、启动编排、开发者工具和资源构建脚本，不维护 Firekylin 的文章、用户、主题、插件或后台业务代码。

`firekylin-source.json` 固定上游仓库和完整提交 SHA。`npm run build` 会：

1. 获取该提交到 `.cache/firekylin`。
2. 使用独立安装的 pnpm 和上游锁文件安装依赖，构建官方后台。
3. 将上游源码和必要运行依赖转换为浏览器文件树及分包快照。

所有下载源码、安装依赖和快照都被 Git 忽略；Git 仓库不提交 Firekylin 源码副本、`node_modules` 或构建产物。构建脚本仅选择打包内容，不改写 Firekylin 的业务源文件。

当前固定提交包含 [Firekylin PR #993](https://github.com/firekylin/firekylin/pull/993) 的兼容性修复：按需加载 SQLite/sharp，以及正确设置 PostgreSQL 连接池大小。此 PR 尚未合并；合并后可更新固定提交。发布包 2.19.0 尚不包含这些修复，不能直接替换成它。

Playground 的 `start-playground.cjs` 负责创建临时数据库、调用上游安装器与迁移、初始化体验内容和一次性登录。`blueprint-runner.cjs` 调用上游文章服务；这些是体验编排，不是另一份博客实现。由于目前使用了上游内部模块，升级固定版本时必须运行完整集成检查。

## 检查

```sh
npm run check
npm test
npm run build
npm run test:integration
```

集成检查从同一组浏览器快照恢复真实 Firekylin，在临时端口验证文章、登录、CLI、数据库工具和语言切换，然后清理。UI 检查使用 DOM 模拟环境，不等同于完整浏览器中的 WebContainer 端到端检查。

GitHub Actions 在提交和 PR 时执行上述流程。

## 运行约束

- 部署静态文件时必须提供 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`。本地服务器已配置。
- WebContainers 首次加载需要联网，其 Node.js 版本由平台提供。
- 不支持原生 Vim、SQLite 驱动和 sharp 图像处理；文件编辑可使用 Files。
- 站点已经运行时再次执行 `firekylin` 会冲突，不是无损重启命令；新插件配置生效仍需重新加载应用。
- 目前快照较大；本项目是功能原型，未提供运行数据持久化或完整本地开发环境。

## 目录

- `index.html`、`style.css`、`app.js`、`i18n.mjs`：Playground 界面。
- `devtools.mjs`、`db-tool.cjs`：开发者工具及数据库桥接。
- `start-playground.cjs`、`blueprint*.{mjs,cjs}`：临时站点初始化。
- `build.mjs`、`prepare*.mjs`、`source.mjs`：独立资源构建。
- `serve.mjs`：本地静态服务器。
- `test/`：配置、界面状态和真实服务集成检查。

## 许可与素材

代码采用 GPL-3.0-only，见 LICENSE。Logo 图形与动画来自 Firekylin 官网，见 THIRD_PARTY_NOTICES.md。第三方依赖保留其各自许可；使用 WebContainer 服务须遵守其服务条款。
