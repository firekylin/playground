# Firekylin Playground

在浏览器里运行临时 Firekylin 站点。Node.js 由 WebContainers 提供，数据库使用 PGlite；预览服务器仅分发静态文件，不在服务器运行用户的博客。

## 开始使用

需要 Node.js 24.15+（24.x）、npm、Git，以及首次构建时的网络连接：

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

`npm run build` 直接从 `firekylin/firekylin` 的 `master` 分支构建：

1. 获取 `master` 最新提交到 `.cache/firekylin`。
2. 使用独立安装的 pnpm 和上游锁文件安装依赖，构建官方后台。
3. 将上游源码和必要运行依赖转换为浏览器文件树及分包快照。

所有下载源码、安装依赖和快照都被 Git 忽略；Git 仓库不提交 Firekylin 源码副本、`node_modules` 或构建产物。构建脚本仅选择打包内容，不改写 Firekylin 的业务源文件。


Playground 的 `runtime/start-playground.cjs` 负责创建临时数据库、调用上游安装器与迁移、初始化体验内容和一次性登录。`runtime/seed-site.cjs` 调用上游文章服务创建固定示例内容；这些是体验编排，不是另一份博客实现。由于目前使用了上游内部模块，每次更新上游代码后都应运行完整集成检查。

## 检查

```sh
npm run check
npm test
npm run build
npm run test:static
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

## 部署到 Vercel

在 Vercel 导入此 GitHub 仓库，使用仓库根目录作为 Root Directory。项目已通过 `vercel.json` 指定：

- Framework Preset：Other。
- Install Command：`npm ci --ignore-scripts`。
- Build Command：`npm run build`。
- Output Directory：`dist`。
- Node.js：24.x（仅用于构建）。

构建时获取 Firekylin `master` 最新代码，所有页面、SDK、数据库依赖和运行快照统一输出到 `dist/`。Vercel 直接托管这些静态文件，不需要 Functions、自建服务或服务器数据库。WebContainer 必需的跨源隔离响应头已配置在 `vercel.json`。

`npm run preview` 仅用于本地预览 `dist/`，不会部署或启动在线服务。Vercel 的构建 Node.js 版本不影响浏览器内 WebContainer 的 Node.js 版本。

## 目录

```text
src/                 Playground 界面和开发者工具
public/              Logo 等静态素材
runtime/             浏览器内的启动、固定示例初始化、数据库桥接
scripts/             构建、打包、检查和本地静态预览
test/               界面、静态资源和真实服务集成检查
dist/                完整静态部署产物（自动生成，不提交）
vercel.json          Vercel 构建及响应头设置
```

已移除 Blueprint 配置协议、校验器、通用步骤执行器和配置文档。初始化脚本只创建固定演示站点，语言由界面选择传入，不再加载或分享自定义配置。

## 许可与素材

代码采用 GPL-3.0-only，见 LICENSE。Logo 图形与动画来自 Firekylin 官网。第三方依赖保留其各自许可；使用 WebContainer 服务须遵守其服务条款。
