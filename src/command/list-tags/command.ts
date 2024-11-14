import { command, option as o, program } from "@why-ts/cli";
import handler, { DEFAULT_FORMAT, DEFAULT_REGISTRY } from "./handler";

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
	.option(
		["format", "f"],
		o.choice(["json", "csv"] as const, {
			required: true,
			description: "Output Format",
			fallback: () => DEFAULT_FORMAT,
		})
	)
	.handle(handler);
