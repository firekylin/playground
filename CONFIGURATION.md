# Initialization format

The UI starts a default temporary writing site. It does not expose a configuration editor or site library. Legacy `#config=` and `#blueprint=` links can still supply a validated initialization recipe.

The shared validator in `blueprint.mjs` defines version 1:

- `title`, optional `description`, `landingPage` and `login`.
- `locale`: `zh-CN` or `en-US`; the UI language overrides this at startup.
- `runtime`: production/development mode, heap limit, warning tracing and restricted environment variables. Node version selection is not supported.
- `steps`: `setSiteOptions`, `activateTheme` (bundled default theme only), and `createPost`.

The runner uses Firekylin's actual models and PostCommandService. Unsupported fields, steps, duplicate paths, external redirects and excessive payload sizes are rejected before startup.

A recipe describes initial content, not a database/file backup. Refreshing or restarting creates a new runtime.
