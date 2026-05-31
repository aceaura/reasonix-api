import { Hono } from "hono";
import { getConfig } from "../config.js";
import { getFactory } from "../lib/client.js";
import type { ModelInfo } from "../lib/types.js";

const modelsRouter = new Hono();

/** List available models */
modelsRouter.get("/", (c) => {
	const factory = getFactory();
	const config = getConfig();

	// All model IDs known to the factory (exclude "default" fallback key)
	const allModelIds = factory
		.getAvailableModels()
		.filter((id) => id !== "default");

	const models: ModelInfo[] = allModelIds.map((id) => ({
		id,
		object: "model",
		created: Math.floor(Date.now() / 1000),
		owned_by: factory.mapModel(id),
		permission: [],
	}));

	// Also include the default model if not already covered
	if (!allModelIds.includes(config.defaultModel)) {
		models.push({
			id: config.defaultModel,
			object: "model",
			created: Math.floor(Date.now() / 1000),
			owned_by: "reasonix",
			permission: [],
		});
	}

	return c.json({
		object: "list",
		data: models,
	});
});

/** Retrieve a specific model */
modelsRouter.get("/:model", (c) => {
	const factory = getFactory();
	const modelId = c.req.param("model");

	const deepseekModel = factory.mapModel(modelId);

	const model: ModelInfo = {
		id: modelId,
		object: "model",
		created: Math.floor(Date.now() / 1000),
		owned_by: deepseekModel,
		permission: [],
	};

	return c.json(model);
});

export { modelsRouter };
