import type { AgentPlugin, PluginActionHandler } from "./types";

const plugins = new Map<string, AgentPlugin>();
const actionHandlers = new Map<string, PluginActionHandler>();

export function registerPlugin(plugin: AgentPlugin): void {
  if (plugins.has(plugin.name)) {
    throw new Error(`Plugin "${plugin.name}" is already registered`);
  }

  for (const action of plugin.actions) {
    if (actionHandlers.has(action.type)) {
      throw new Error(`Action type "${action.type}" is already registered by another plugin`);
    }
    actionHandlers.set(action.type, action);
  }

  plugins.set(plugin.name, plugin);
}

export function unregisterPlugin(name: string): void {
  const plugin = plugins.get(name);
  if (!plugin) return;
  for (const action of plugin.actions) {
    actionHandlers.delete(action.type);
  }
  plugins.delete(name);
}

export function getActionHandler(type: string): PluginActionHandler | null {
  return actionHandlers.get(type) ?? null;
}

export function listPlugins(): Array<{ name: string; version: string; actions: string[] }> {
  return [...plugins.values()].map(p => ({
    name: p.name,
    version: p.version,
    actions: p.actions.map(a => a.type)
  }));
}

export function getRegisteredActionTypes(): string[] {
  return [...actionHandlers.keys()];
}

export function clearPlugins(): void {
  plugins.clear();
  actionHandlers.clear();
}
