import { Plugin } from "@opencode/plugin";
import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface ClaudePlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  tools?: any[];
  hooks?: any;
}

interface PluginState {
  loadedPlugins: Map<string, ClaudePlugin>;
  activePlugins: Set<string>;
}

const state: PluginState = {
  loadedPlugins: new Map(),
  activePlugins: new Set(),
};

export default Plugin.define({
  id: "claude-bridge",
  async setup(ctx) {
    // Initialize plugin state
    await ctx.storage.set("claude-plugins", { loaded: [], active: [] });

    // Scan for local and user plugins
    await scanPlugins(ctx);

    // Register tools from active plugins
    await registerPluginTools(ctx);

    // Set up hooks
    setupHooks(ctx);

    // Watch for plugin changes
    const watcher = setupPluginWatcher(ctx);

    // Register commands
    await registerCommands(ctx);

    return async () => {
      // Cleanup on unload
      watcher.close();
      await ctx.storage.remove("claude-plugins");
    };
  },
});

async function scanPlugins(ctx: any) {
  const localDir = path.join(ctx.location.directory, ".claude", "skills");
  const userDir = path.join(process.env.HOME || "", ".claude", "skills");

  await scanDirectory(localDir, ctx);
  await scanDirectory(userDir, ctx);
}

async function scanDirectory(dir: string, ctx: any) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = path.join(dir, entry.name);
        await loadPlugin(pluginPath, ctx);
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be read
    console.debug(`Could not scan directory ${dir}: ${err}`);
  }
}

async function loadPlugin(pluginPath: string, ctx: any) {
  try {
    const manifestPath = path.join(pluginPath, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

    const toolsPath = path.join(pluginPath, "tools.json");
    let tools = [];
    try {
      tools = JSON.parse(await fs.readFile(toolsPath, "utf-8"));
    } catch (err) {
      console.debug(`No tools.json found for ${manifest.id}`);
    }

    const hooksPath = path.join(pluginPath, "hooks.js");
    let hooks = {};
    try {
      hooks = require(hooksPath);
    } catch (err) {
      console.debug(`No hooks.js found for ${manifest.id}`);
    }

    const plugin: ClaudePlugin = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      tools,
      hooks,
    };

    state.loadedPlugins.set(plugin.id, plugin);
    await updatePluginState(ctx);
  } catch (err) {
    console.error(`Failed to load plugin from ${pluginPath}: ${err}`);
  }
}

async function registerPluginTools(ctx: any) {
  await ctx.tool.transform((editor: any) => {
    for (const [id, plugin] of state.loadedPlugins) {
      if (plugin.tools && state.activePlugins.has(id)) {
        editor.namespace({
          name: plugin.id,
          description: plugin.description || `Tools from ${plugin.name}`,
        });

        for (const tool of plugin.tools) {
          editor.add({
            name: tool.name,
            description: tool.description,
            input: tool.input_schema,
            options: { namespace: plugin.id },
            execute: async (input: any, context: any) => {
              // Execute the tool through the plugin's hooks
              if (plugin.hooks && plugin.hooks[`tool.${tool.name}`]) {
                return await plugin.hooks[`tool.${tool.name}`](input, context);
              }
              return { content: `Tool ${tool.name} executed successfully` };
            },
          });
        }
      }
    }
  });
}

function setupHooks(ctx: any) {
  ctx.session.hook("context", async (event: any) => {
    for (const [id, plugin] of state.loadedPlugins) {
      if (state.activePlugins.has(id) && plugin.hooks) {
        for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
          if (hookName.startsWith("session.")) {
            try {
              await hookFn(event);
            } catch (err) {
              console.error(`Error in hook ${hookName} from plugin ${id}: ${err}`);
            }
          }
        }
      }
    }
  });
}

function setupPluginWatcher(ctx: any) {
  const localDir = path.join(ctx.location.directory, ".claude", "skills");
  const userDir = path.join(process.env.HOME || "", ".claude", "skills");

  const watcher = fs.watch(localDir, { recursive: true }, async (event, filename) => {
    if (filename && filename.endsWith("manifest.json")) {
      const pluginPath = path.dirname(path.join(localDir, filename));
      await loadPlugin(pluginPath, ctx);
      await registerPluginTools(ctx);
    }
  });

  fs.watch(userDir, { recursive: true }, async (event, filename) => {
    if (filename && filename.endsWith("manifest.json")) {
      const pluginPath = path.dirname(path.join(userDir, filename));
      await loadPlugin(pluginPath, ctx);
      await registerPluginTools(ctx);
    }
  });

  return watcher;
}

async function updatePluginState(ctx: any) {
  const storage = await ctx.storage.get("claude-plugins");
  const loaded = Array.from(state.loadedPlugins.keys());
  const active = Array.from(state.activePlugins);

  if (JSON.stringify(storage.loaded) !== JSON.stringify(loaded) ||
      JSON.stringify(storage.active) !== JSON.stringify(active)) {
    await ctx.storage.set("claude-plugins", { loaded, active });
  }
}

async function registerCommands(ctx: any) {
  await ctx.command.transform((editor: any) => {
    editor.add({
      name: "claude-plugins",
      description: "Manage and browse Claude plugins",
      execute: async ({ sessionID, prompt, delivery }: any) => {
        await ctx.session.prompt({
          ...prompt,
          sessionID,
          text: "Showing available Claude plugins...",
          delivery,
        });
      },
    });
  });
}

// TUI Integration
async function showClaudePluginsTUI(ctx: any) {
  const plugins = await ctx.storage.get("claude-plugins");

  // This would be implemented in the TUI system
  // For now, we'll just log the available plugins
  console.log("Available Claude Plugins:");
  for (const pluginId of plugins.loaded) {
    const plugin = state.loadedPlugins.get(pluginId);
    console.log(`- ${plugin.name} (${plugin.version})${state.activePlugins.has(pluginId) ? " [ACTIVE]" : ""}`);
  }
}

// Plugin Management Functions
async function installPluginFromRepo(ctx: any, repoUrl: string) {
  try {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-plugin-"));
    await execAsync(`git clone ${repoUrl} ${tempDir}`);

    // Find the plugin directory (assuming it's in the root or a subdirectory)
    const pluginDir = await findPluginDirectory(tempDir);

    if (pluginDir) {
      const userPluginsDir = path.join(process.env.HOME || "", ".claude", "skills");
      const pluginName = path.basename(pluginDir);
      const destDir = path.join(userPluginsDir, pluginName);

      await fs.cp(pluginDir, destDir, { recursive: true });
      await loadPlugin(destDir, ctx);
      await registerPluginTools(ctx);

      console.log(`Successfully installed plugin from ${repoUrl}`);
      return true;
    } else {
      console.error("No valid plugin found in the repository");
      return false;
    }
  } catch (err) {
    console.error(`Failed to install plugin from ${repoUrl}: ${err}`);
    return false;
  }
}

async function findPluginDirectory(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(dir, entry.name);
        const manifestPath = path.join(subDir, "manifest.json");

        try {
          await fs.access(manifestPath);
          return subDir;
        } catch (err) {
          // Not a plugin directory
        }
      }
    }

    // Check if this directory itself is a plugin
    const manifestPath = path.join(dir, "manifest.json");
    try {
      await fs.access(manifestPath);
      return dir;
    } catch (err) {
      return null;
    }
  } catch (err) {
    console.error(`Error searching for plugin directory: ${err}`);
    return null;
  }
}

// Command to show the TUI
async function showPluginsCommand(ctx: any) {
  await showClaudePluginsTUI(ctx);
}

// Command to install a plugin from a repository
async function installPluginCommand(ctx: any, repoUrl: string) {
  await installPluginFromRepo(ctx, repoUrl);
}
