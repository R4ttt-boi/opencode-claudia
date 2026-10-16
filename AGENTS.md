# Claude Compatibility Extension Guidelines

- This project builds an OpenCode TypeScript plugin to bridge Claude Code skills/prompts and hook conventions.
- Plugins use `Plugin.define` from `@opencode/plugin`.
- Always verify type safety by running `npx tsc --noEmit` after changing code.
