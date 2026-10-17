# Claude Compatibility Extension Guidelines

## Project Goal
This repository creates an OpenCode TypeScript plugin to bridge Claude Code skills/prompts and hook conventions, enabling Claude plugins to work with OpenCode.

## Project Structure
- TypeScript OpenCode plugin at `.opencode/plugins/claude-bridge.ts.bak`
- Configuration in `.opencode/opencode.json` and `.vscode/settings.json`
- Skills in `.opencode/skills/claude-bridge/`

## Development Workflow
- Run `npx tsc --noEmit` for type safety verification after changes
- Working source file is `.opencode/plugins/claude-bridge.ts.bak`
- Do NOT create `.opencode/plugins/claude-bridge.ts` — OpenCode auto-loads any `.ts` plugin file in that directory, and this instance must not load the plugin
- Plugin uses `Plugin.define` from `@opencode/plugin`

## Plugin Architecture
- Bridges Claude Code skills from `.claude/skills` (local) and `~/.claude/skills` (user) directories
- Loads plugin manifests from `manifest.json`, tools from `tools.json`, and hooks from `hooks.js`
- Maps Claude tool schemas to OpenCode format via `tools:register` hook

## Testing Claude Plugins

To test with actual Claude plugins:

1. **Create plugin structure** in `.claude/skills/` or `~/.claude/skills/`
   - `manifest.json` - Plugin metadata (name, version, config)
   - `tools.json` - Tool definitions (array of tool objects)
   - `hooks.js` - Optional (exports hook functions)

2. **Run test script**: `node /tmp/simple-test.js`
   - Verifies the bridge scans both local and user skill directories
   - Loads manifest, tools, and hooks
   - Transforms tools from Claude schema to OpenCode format
   - Executes `tools:register` and other hooks

3. **Successful test output shows**:
   ```
   Found plugin: test-plugin
     Manifest: { name: 'test-plugin', version: '1.0.0', ... }
     Tools: hello_world, get_system_info
     Hooks: [ 'tools:register', 'command:hello' ]
     Transformed tools: hello_world, get_system_info
   Executing tools:register hook...
   [Test Plugin] Registering tools: hello_world, get_system_info
   Executing command:hello hook...
   [Test Plugin] Command executed: test
   Hook result: { success: true, message: 'Hello from test plugin!' }
   ```

4. **Test plugin location**: `test-claude-plugin/` directory contains example

## Critical Constraints
- DO NOT LET THIS OPENCODE INSTANCE LOAD THE PLUGIN directly — OpenCode auto-loads any `.ts` in `.opencode/plugins/`, causing conflicts
- Always test plugin changes in a separate OpenCode instance first
- Current working source is `.opencode/plugins/claude-bridge.ts.bak` (use to understand implementation)
- Repository can be tested in `/tmp` if needed
- Do not create `opencode-claudia/.opencode/plugins/claude-bridge.ts` in this repo (the opencode.json config excludes this path to prevent self-loading)

## Commands & TUI for Claude Plugin Management

### OpenCode CLI Commands
- List registered plugins: `opencode plugin list` (or in TUI: Plugins pane)
- Reload plugins: `opencode plugin reload`
- Add/remove plugins dynamically via the plugin system

### TUI Interface
- Open the TUI with `opencode tui` 
- Navigate to the **Plugins** section to view/manage discovered Claude plugins
- Each plugin shows: name, version, registered tools, available hooks
- Use the context menu to enable/disable or reload individual plugins

### Plugin Discovery Behavior
OpenCode automatically scans these directories on startup:
- `.claude/skills` (local project directory)
- `~/.claude/skills` (user home directory)
- `.opencode/plugins/` (plugin .ts files — **DO NOT place claude-bridge.ts here in this repo**)

Each directory must contain subdirectories with `manifest.json`, `tools.json`, and optional `hooks.js`.

### Safe Testing in /tmp
To test without risking repo state:
1. `cd /tmp && opencode` (opens fresh instance with no loaded plugins)
2. Create a test plugin dir: `mkdir -p .claude/skills/test-plugin`
3. Add the required files (manifest.json, tools.json, hooks.js)
4. Run: `node /tmp/simple-test.js` to verify loading and schema conversion
5. Full integration: copy `.opencode/plugins/claude-bridge.ts.bak` to `.opencode/plugins/claude-bridge.ts` in that /tmp instance

### Example Plugin Lifecycle
```
mkdir -p .claude/skills/my-plugin
# create manifest.json, tools.json, hooks.js
opencode plugin reload   # TUI or CLI: rediscover plugins
# Now my-plugin is available with its tools/hooks
```

## Files to Understand
- `.opencode/plugins/claude-bridge.ts.bak` - Full implementation (contains bridge logic)
- `.opencode/opencode.json` - Plugin loading configuration (loads all plugins EXCEPT the bridge at `~/repos/opencode-claudia/.opencode/plugins/claude-bridge.ts` to prevent self-loading in dev)
- `.vscode/settings.json` - IDE configuration
- `test-claude-plugin/` - Example Claude plugin structure for testing
- `/tmp/simple-test.js` - Verification script for bridge logic