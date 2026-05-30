import { Hono } from "hono";
import { getConfig } from "../config.js";
import type { ModelInfo } from "../lib/types.js";

const modelsRouter = new Hono();

/** List available models */
modelsRouter.get("/", (c) => {
	const config = getConfig();
	const models: ModelInfo[] = Object.entries(config.modelMapping).map(
		([openaiModel, deepseekModel]) => ({
			id: openaiModel,
			object: "model",
			created: Math.floor(Date.now() / 1000),
			owned_by: deepseekModel,
			permission: [],
		}),
	);

	// Always include the default model
	const defaultModel: ModelInfo = {
		id: config.defaultModel,
		object: "model",
		created: Math.floor(Date.now() / 1000),
		owned_by: "reasonix",
		permission: [],
	};

	const allModels = [...models];
	if (!allModels.some((m) => m.id === defaultModel.id)) {
		allModels.push(defaultModel);
	}

	return c.json({
		object: "list",
		data: allModels,
	});
});

/** Retrieve a specific model */
modelsRouter.get("/:model", (c) => {
	const config = getConfig();
	const modelId = c.req.param("model");

	const deepseekModel = config.modelMapping[modelId] ?? config.defaultModel;

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
