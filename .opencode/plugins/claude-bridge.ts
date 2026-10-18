import { Plugin } from '@opencode/plugin';
import path from 'path';
import fs from 'fs';

interface PluginState {
  loadedPlugins: Map<string, any>;
  activePlugins: Set<string>;
}

const state: PluginState = {
  loadedPlugins: new Map(),
  activePlugins: new Set()
};

export default Plugin.define({
  id: 'claude-bridge',
  async setup(ctx: any) {
    console.log('Claude Bridge Plugin Initialized');
    
    // Initialize storage
    await ctx.storage.set('claude-plugins', { loaded: [], active: [] });
    
    // Scan for plugins
    await scanPlugins(ctx);
    
    // Register tools
    await registerPluginTools(ctx);
    
    // Set up hooks
    setupHooks(ctx);
    
    // Watch for plugin changes
    setupPluginWatcher(ctx);
    
    // Register commands
    await registerCommands(ctx);
    
    return async () => {
      console.log('Cleaning up plugin watchers...');
      // Proper cleanup of watchers
      if (ctx.watchers) {
        for (const watcher of ctx.watchers) {
          watcher.close();
        }
      }
      await ctx.storage.remove('claude-plugins');
    };
  }
});

async function scanPlugins(ctx: any) {
  const localDir = path.join(ctx.location.directory, '.claude', 'skills');
  const userDir = path.join(process.env.HOME || '', '.claude', 'skills');
  
  await scanDirectory(localDir, ctx);
  await scanDirectory(userDir, ctx);
}

async function scanDirectory(dir: string, ctx: any) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = path.join(dir, entry.name);
        await loadPlugin(pluginPath, ctx);
      }
    }
  } catch (err) { console.error(`Error scanning ${dir}:`, err); }
}

async function loadPlugin(pluginPath: string, ctx: any) {
  try {
    const manifestPath = path.join(pluginPath, 'manifest.json');
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8'));
    
    const toolsPath = path.join(pluginPath, 'tools.json');
    let tools = [];
    try {
      tools = JSON.parse(await fs.promises.readFile(toolsPath, 'utf-8'));
    } catch (err) { console.debug(`No tools.json found in ${pluginPath}`); }
    
    const hooksPath = path.join(pluginPath, 'hooks.js');
    let hooks = {};
    try {
      const hooksModule = require(hooksPath);
      hooks = hooksModule;
    } catch (err) { console.debug(`No hooks.js found in ${pluginPath}`); }
    
    const plugin = {
      id: manifest.id || manifest.name,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      tools,
      hooks
    };
    
    state.loadedPlugins.set(plugin.id, plugin);
    await updatePluginState(ctx);
    console.log(`Loaded plugin: ${plugin.name} (ID: ${plugin.id})`);
  } catch (err) { console.error(`Failed to load plugin ${pluginPath}:`, err); }
}

async function registerPluginTools(ctx: any) {
  await ctx.tool.transform((editor: any) => {
    for (const [id, plugin] of state.loadedPlugins) {
      if (state.activePlugins.has(id)) {
        editor.namespace({
          name: plugin.id,
          description: plugin.description || `Tools from ${plugin.name}`
        });
        
        for (const tool of plugin.tools || []) {
          editor.add({
            name: tool.name,
            description: tool.description,
            input: tool.parameters || [],
            options: { namespace: plugin.id },
            execute: async (input: any, context: any) => {
              if (plugin.hooks && plugin.hooks['tool.' + tool.name]) {
                return await plugin.hooks['tool.' + tool.name](input, context);
              }
              return { content: `Executed ${tool.name} with input: ${JSON.stringify(input)}` };
            }
          });
        }
      }
    }
  });
}

function setupHooks(ctx: any) {
  ctx.session.hook('context', async (event: any) => {
    for (const [id, plugin] of state.loadedPlugins) {
      if (state.activePlugins.has(id) && plugin.hooks) {
        for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
          if (hookName.startsWith('tool.')) {
            try {
              await hookFn(event);
            } catch (err) {
              console.error(`Error in tool hook ${hookName}:`, err);
            }
          }
        }
      }
    }
  });
}

function setupPluginWatcher(ctx: any) {
  const localDir = path.join(ctx.location.directory, '.claude', 'skills');
  const userDir = path.join(process.env.HOME || '', '.claude', 'skills');
  
  // Initialize watchers array in context
  ctx.watchers = [];
  
  // Local watcher
  const localWatcher = fs.watch(localDir, { recursive: true }, async (event, filename) => {
    if (filename && filename.endsWith('manifest.json')) {
      const pluginPath = path.dirname(path.join(localDir, filename));
      await loadPlugin(pluginPath, ctx);
      await registerPluginTools(ctx);
    }
  });
  ctx.watchers.push(localWatcher);
  
  // User watcher
  const userWatcher = fs.watch(userDir, { recursive: true }, async (event, filename) => {
    if (filename && filename.endsWith('manifest.json')) {
      const pluginPath = path.dirname(path.join(userDir, filename));
      await loadPlugin(pluginPath, ctx);
      await registerPluginTools(ctx);
    }
  });
  ctx.watchers.push(userWatcher);
}

async function updatePluginState(ctx: any) {
  const storage = await ctx.storage.get('claude-plugins');
  const loadedPlugins = Array.from(state.loadedPlugins.keys());
  const activePlugins = Array.from(state.activePlugins);
  
  if (JSON.stringify(storage.loaded) !== JSON.stringify(loadedPlugins)
      || JSON.stringify(storage.active) !== JSON.stringify(activePlugins)) {
    await ctx.storage.set('claude-plugins', { loaded: loadedPlugins, active: activePlugins });
  }
}

async function registerCommands(ctx: any) {
  await ctx.command.transform((editor: any) => {
    editor.add({
      name: 'claude-plugins:list',
      description: 'List all registered Claude plugins',
      execute: async () => {
        const plugins = await ctx.storage.get('claude-plugins');
        console.log('Available Plugins:');
        for (const pluginId of plugins.loaded) {
          const plugin = state.loadedPlugins.get(pluginId);
          console.log(`- ${plugin.name} (${plugin.version}) [${state.activePlugins.has(pluginId) ? 'ACTIVE' : 'INACTIVE'}]`);
        }
      }
    });
    
    editor.add({
      name: 'claude-plugins:toggle',
      description: 'Toggle plugin activation',
      execute: async (args: any) => {
        const pluginId = args.pluginId || 'test-plugin';
        const plugin = state.loadedPlugins.get(pluginId);
        if (!plugin) {
          console.error(`Plugin ${pluginId} not found.`);
          return;
        }
        if (state.activePlugins.has(pluginId)) {
          state.activePlugins.delete(pluginId);
        } else {
          state.activePlugins.add(pluginId);
        }
        await updatePluginState(ctx);
        console.log(`Plugin ${pluginId} is now ${state.activePlugins.has(pluginId) ? 'active' : 'inactive'}.`);
      }
    });
  });
}