import type { Plugin } from "@opencode/plugin";

export default (async ({ client, project, directory, $ }) => {
  // Example hook: Intercept tool execution
  return {
    "tool.execute.before": async (input, output) => {
      // Modify tool arguments here
      console.log(`Intercepted tool call: ${input.toolName}`);
    },
  };
}) satisfies Plugin;