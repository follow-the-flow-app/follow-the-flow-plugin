# Contributing

This repository is the plugin's source. Open an issue, or a pull request against `dev`; merging `dev` into `main` publishes the change, because clients install `main`. A change to any plugin file bumps the plugin version in `plugin.json` and in `.claude-plugin/marketplace.json` together, and `npm test` and `npm run validate` must pass.
