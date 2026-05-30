import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// API Event Bus (used by routes/chat.ts and middleware/error-handler.ts)
// ---------------------------------------------------------------------------

/** Event types emitted by the Reasonix API */
export interface ApiEvents {
	"request.start": (params: {
		method: string;
		path: string;
		requestId: string;
	}) => void;
	"request.end": (params: {
		method: string;
		path: string;
		requestId: string;
		statusCode: number;
		durationMs: number;
	}) => void;
	"session.created": (params: { sessionId: string; model: string }) => void;
	"session.expired": (params: { sessionId: string }) => void;
	"chat.completion": (params: {
		model: string;
		promptTokens: number;
		completionTokens: number;
		cachedTokens?: number;
		sessionId?: string;
	}) => void;
	error: (params: {
		message: string;
		code: string;
		statusCode: number;
		requestId?: string;
	}) => void;
}

/** Typed event emitter for the API */
class ApiEventEmitter extends EventEmitter {
	emit<K extends keyof ApiEvents>(
		event: K,
		...args: Parameters<ApiEvents[K]>
	): boolean {
		return super.emit(event as string, ...args);
	}

	on<K extends keyof ApiEvents>(event: K, listener: ApiEvents[K]): this {
		return super.on(event as string, listener as (...args: unknown[]) => void);
	}

	once<K extends keyof ApiEvents>(event: K, listener: ApiEvents[K]): this {
		return super.once(
			event as string,
			listener as (...args: unknown[]) => void,
		);
	}

	off<K extends keyof ApiEvents>(event: K, listener: ApiEvents[K]): this {
		return super.off(event as string, listener as (...args: unknown[]) => void);
	}
}

/** Global event bus for the API */
export const eventBus = new ApiEventEmitter();
