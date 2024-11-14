import { command, option as o } from "@why-ts/cli";
import handler, { DEFAULT_REGISTRY } from "./handler";

export default command({ description: "List all tags of a Docker image" })
	.option(
		["repository", "r"],
		o.string({ required: true, description: "The repository" })
	)
	.option(
		["registry", "g"],
		o.string({
			required: true,
			description: "The registry URL. Defaults to Docker Hub",
			fallback: () => DEFAULT_REGISTRY,
		})
	)
	.handle(handler);
