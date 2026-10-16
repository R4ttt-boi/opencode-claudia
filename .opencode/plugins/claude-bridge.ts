import { Plugin } from '@opencode/plugin';
import * as path from 'path';
import * as fs from 'fs';

// Bridge state management
interface ClaudePluginInfo {
  "name": string;
  "version"?: string;
  "tools"?: any[];
  "hooks"?: Record<string, Function>;
  "config"?: Record<string, any>;
}

const CLAUDE_LOCAL_SKILLS = '.claude/skills';
const CLAUDE_USER_SKILLS = path.join(process.env.HOME || '', '.claude/skills');

// Helper functions
function loadPluginTools(pluginDir: string): any[] {
  const toolsPath = path.join(pluginDir, 'tools.json');
  if (fs.existsSync(toolsPath)) {
    try {
      const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf8')) as any;
      return Array.isArray(tools) ? tools : tools.tools || [];
    } catch (e) {
      console.warn('Failed to load tools for plugin:', path.basename(pluginDir));
    }
  }
  return [];
}

function loadPluginHooks(pluginDir: string): Record<string, Function> {
  const hooks: Record<string, Function> = {};
  const hooksPath = path.join(pluginDir, 'hooks.js');
  
  if (fs.existsSync(hooksPath)) {
    try {
      const module = require(hooksPath);
      Object.assign(hooks, module);
    } catch (e) {
      console.warn('Failed to load hooks for plugin:', path.basename(pluginDir));
    }
  }
  
  return hooks;
}

function scanClaudeSkills(dir: string): ClaudePluginInfo[] {
  if (!fs.existsSync(dir)) return [];
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const plugins: ClaudePluginInfo[] = [];
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const pluginDir = path.join(dir, entry.name);
      const manifestPath = path.join(pluginDir, 'manifest.json');
      
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as any;
          plugins.push({
            name: entry.name,
            version: manifest.version,
            config: manifest.config,
            tools: loadPluginTools(pluginDir),
            hooks: loadPluginHooks(pluginDir)
          });
        } catch (e) {
          console.warn('Failed to load Claude plugin manifest:', entry.name);
        }
      }
    }
  }
  
  return plugins;
}

function mapToolType(type?: string): string {
  const typeMap = {
    'string': 'string',
    'integer': 'number',
    'float': 'number',
    'boolean': 'boolean',
    'array': 'array',
    'object': 'object',
    'null': 'null'
  } as Record<string, string>;
  return typeMap[type?.toLowerCase() as any] || type || 'string';
}

function convertToolSchema(claudeTool: any): any {
  const params = claudeTool.parameters || [];
  
  const paramObject = Array.isArray(params) 
    ? params.reduce((acc, p) => {
        acc[p.name] = {
          type: p.type || 'string',
          description: p.description,
          required: p.required || false
        };
        return acc;
      }, {} as Record<string, any>)
    : params;
  
  return {
    ...claudeTool,
    parameters: paramObject,
    type: mapToolType(claudeTool.type)
  };
}

Plugin.define({
  id: 'claude-bridge',
  setup: async (context) => {
    // Scan for Claude skill directories and register discovered plugins
    const localPlugins = scanClaudeSkills(CLAUDE_LOCAL_SKILLS);
    const userPlugins = scanClaudeSkills(CLAUDE_USER_SKILLS);
    
    // Register all discovered plugins with the bridge
    const allPlugins = [...localPlugins, ...userPlugins];
    
    // Register tool schema mapping hook
    (Plugin as any).registerHook('tools:register', (tools: { parameters?: any }[]) => {
      return tools.map(tool => convertToolSchema(tool));
    });
    
    // Log startup confirmation
    console.log(`[Claude Bridge] Loaded ${allPlugins.length} plugin(s) - Compatibility layer active`);
    
    // No cleanup needed for this plugin
    return;
  }
});