import type { ToolDefinition } from "./types.js";

/** Registry of available tools */
const toolRegistry = new Map<string, ToolDefinition>();

/** Register a tool */
export function registerTool(tool: ToolDefinition): void {
	if (toolRegistry.has(tool.name)) {
		throw new Error(`Tool already registered: ${tool.name}`);
	}
	toolRegistry.set(tool.name, tool);
}

/** Unregister a tool */
export function unregisterTool(name: string): boolean {
	return toolRegistry.delete(name);
}

/** Get a tool by name */
export function getTool(name: string): ToolDefinition | undefined {
	return toolRegistry.get(name);
}

/** List all registered tools */
export function listTools(): ToolDefinition[] {
	return Array.from(toolRegistry.values());
}

/** Get tool definitions in OpenAI-compatible format */
export function getOpenAIToolDefinitions(): Array<{
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}> {
	return Array.from(toolRegistry.values()).map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	}));
}

/** Execute a tool call */
export async function executeToolCall(
	name: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	const tool = getTool(name);
	if (!tool) {
		throw new Error(`Unknown tool: ${name}`);
	}
	return tool.handler(args);
}

/** Clear all registered tools */
export function clearTools(): void {
	toolRegistry.clear();
}
