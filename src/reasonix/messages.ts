/**
 * Deterministic, byte-stable translation of OpenAI request messages into our
 * normalized `EngineMessage[]`.
 *
 * Why this matters: DeepSeek's context cache is server-side and keyed on the
 * BYTE PREFIX of the request. OpenCode is stateless and resends the full history
 * every turn, so turn N+1's prefix must be byte-identical to turn N's prefix for
 * the cache to hit. Therefore this conversion must be a pure, stable function of
 * the input — no timestamps, no random ids, no key reordering, no whitespace
 * normalization that depends on anything external.
 *
 * This file imports nothing from "reasonix".
 */
import type { EngineMessage, EngineToolCall } from "./engine.js";

/** Loose shape of an incoming OpenAI message (post zod-validation). */
export interface OpenAIMessage {
	role: string;
	content?: string | unknown[] | null;
	name?: string;
	tool_call_id?: string;
	tool_calls?: Array<{
		id?: string;
		type?: string;
		function?: { name?: string; arguments?: string };
	}>;
}

/**
 * Flatten OpenAI content (string | content-parts array | null) to a stable string.
 * Content-part arrays (multimodal) are reduced deterministically: text parts are
 * concatenated; non-text parts become a stable placeholder so the byte output is
 * reproducible for an identical input.
 */
export function flattenContent(
	content: string | unknown[] | null | undefined,
): string | null {
	if (content == null) return null;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return String(content);

	const parts: string[] = [];
	for (const part of content) {
		if (part && typeof part === "object") {
			const p = part as {
				type?: string;
				text?: string;
				image_url?: { url?: string };
			};
			if (p.type === "text" && typeof p.text === "string") {
				parts.push(p.text);
			} else if (p.type === "image_url" && p.image_url?.url) {
				// Stable placeholder — deepseek-chat is text-only; keep bytes reproducible.
				parts.push(`[image_url:${p.image_url.url}]`);
			} else {
				parts.push(JSON.stringify(part));
			}
		} else {
			parts.push(String(part));
		}
	}
	return parts.join("");
}

const VALID_ROLES = new Set(["system", "user", "assistant", "tool"]);

function normalizeRole(role: string): EngineMessage["role"] {
	// OpenAI "developer" role maps to "system" for DeepSeek.
	if (role === "developer") return "system";
	if (VALID_ROLES.has(role)) return role as EngineMessage["role"];
	return "user";
}

function normalizeToolCalls(
	toolCalls: OpenAIMessage["tool_calls"],
): EngineToolCall[] | undefined {
	if (!toolCalls || toolCalls.length === 0) return undefined;
	return toolCalls.map((tc) => ({
		id: tc.id,
		type: "function" as const,
		function: {
			name: tc.function?.name ?? "",
			arguments: tc.function?.arguments ?? "",
		},
	}));
}

/** Convert a full OpenAI messages array to normalized engine messages. */
export function toEngineMessages(messages: OpenAIMessage[]): EngineMessage[] {
	return messages.map((m) => {
		const out: EngineMessage = { role: normalizeRole(m.role) };
		const content = flattenContent(m.content);
		// Preserve the distinction: assistant tool-call messages legitimately have
		// null content; tool/user/system messages carry text.
		out.content = content;
		if (m.name !== undefined) out.name = m.name;
		if (m.tool_call_id !== undefined) out.tool_call_id = m.tool_call_id;
		const tc = normalizeToolCalls(m.tool_calls);
		if (tc) out.tool_calls = tc;
		return out;
	});
}

/**
 * The "stable prefix" of a conversation = every message except the final turn.
 * Used to derive a conversation key so resumed/continued conversations from a
 * stateless client (OpenCode) map back to the same logical session.
 *
 * The final turn is everything from the last `user` message onward (a user
 * message plus any trailing tool results it triggered). Returns the prefix
 * messages; if there is no user message, the whole array is the prefix.
 */
export function stablePrefix(messages: EngineMessage[]): EngineMessage[] {
	let lastUser = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role === "user") {
			lastUser = i;
			break;
		}
	}
	if (lastUser <= 0) return [];
	return messages.slice(0, lastUser);
}

/**
 * Canonical, stable serialization of messages for hashing. Deterministic key
 * order; no external state. Two byte-identical conversations serialize identically.
 */
export function canonicalize(messages: EngineMessage[]): string {
	return JSON.stringify(
		messages.map((m) => ({
			role: m.role,
			content: m.content ?? null,
			name: m.name ?? null,
			tool_call_id: m.tool_call_id ?? null,
			tool_calls:
				m.tool_calls?.map((tc) => ({
					id: tc.id ?? null,
					name: tc.function.name,
					arguments: tc.function.arguments,
				})) ?? null,
		})),
	);
}
