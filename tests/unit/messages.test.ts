import { describe, expect, it } from "vitest";
import {
	type OpenAIMessage,
	canonicalize,
	flattenContent,
	stablePrefix,
	toEngineMessages,
} from "../../src/reasonix/messages.js";

describe("flattenContent", () => {
	it("returns strings unchanged", () => {
		expect(flattenContent("hello")).toBe("hello");
	});

	it("preserves null (assistant tool-call messages)", () => {
		expect(flattenContent(null)).toBeNull();
		expect(flattenContent(undefined)).toBeNull();
	});

	it("concatenates text content parts deterministically", () => {
		const content = [
			{ type: "text", text: "a" },
			{ type: "text", text: "b" },
		];
		expect(flattenContent(content)).toBe("ab");
	});

	it("renders image parts as a stable placeholder", () => {
		const content = [
			{ type: "image_url", image_url: { url: "http://x/y.png" } },
		];
		expect(flattenContent(content)).toBe("[image_url:http://x/y.png]");
	});
});

describe("toEngineMessages", () => {
	it("maps developer role to system", () => {
		const out = toEngineMessages([{ role: "developer", content: "x" }]);
		expect(out[0]?.role).toBe("system");
	});

	it("preserves tool_call_id and tool_calls", () => {
		const msgs: OpenAIMessage[] = [
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "f", arguments: "{}" },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_1", content: "result" },
		];
		const out = toEngineMessages(msgs);
		expect(out[0]?.tool_calls?.[0]?.function.name).toBe("f");
		expect(out[1]?.tool_call_id).toBe("call_1");
	});
});

describe("stablePrefix", () => {
	it("excludes the final user turn and everything after", () => {
		const msgs = toEngineMessages([
			{ role: "system", content: "s" },
			{ role: "user", content: "q1" },
			{ role: "assistant", content: "a1" },
			{ role: "user", content: "q2" },
		]);
		const prefix = stablePrefix(msgs);
		expect(prefix.map((m) => m.content)).toEqual(["s", "q1", "a1"]);
	});

	it("returns empty when the first turn is the only user turn", () => {
		const msgs = toEngineMessages([{ role: "user", content: "q1" }]);
		expect(stablePrefix(msgs)).toEqual([]);
	});
});

describe("canonicalize — byte stability", () => {
	it("is identical for identical inputs", () => {
		const a = toEngineMessages([{ role: "user", content: "hello world" }]);
		const b = toEngineMessages([{ role: "user", content: "hello world" }]);
		expect(canonicalize(a)).toBe(canonicalize(b));
	});

	it("keeps the prefix canonical stable as a conversation grows", () => {
		// Turn 1 history (what becomes the prefix on turn 2).
		const turn1 = toEngineMessages([
			{ role: "system", content: "sys" },
			{ role: "user", content: "q1" },
			{ role: "assistant", content: "a1" },
		]);
		// Turn 2 resends full history + a new user turn (stateless client behavior).
		const turn2Full = toEngineMessages([
			{ role: "system", content: "sys" },
			{ role: "user", content: "q1" },
			{ role: "assistant", content: "a1" },
			{ role: "user", content: "q2" },
		]);
		// The prefix of turn 2 must byte-match the full turn-1 history.
		expect(canonicalize(stablePrefix(turn2Full))).toBe(canonicalize(turn1));
	});

	it("differs when content differs", () => {
		const a = toEngineMessages([{ role: "user", content: "a" }]);
		const b = toEngineMessages([{ role: "user", content: "b" }]);
		expect(canonicalize(a)).not.toBe(canonicalize(b));
	});
});
