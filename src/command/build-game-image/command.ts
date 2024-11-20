import { command, option as o } from "@why-ts/cli";
import handler from "./handler";

export default command({ description: "Build Game Server Docker Image" })
	.option(
		["game", "g"],
		o.string({ description: "Game folder. Use --all to build all games." })
	)
	.option(
		["all", "a"],
		o.boolean({
			description: "Build all games in the ./games folder",
		})
	)
	.option(
		["force", "f"],
		o.boolean({
			description: "Build all games in the ./games folder",
		})
	)
	.option(
		["push", "p"],
		o.boolean({
			description: "Push the image to the registry after building",
		})
	)
	.option(
		["namespace", "n"],
		o.string({
			required: true,
			description: "The Docker namespace to use",
			fallback: () =>
				process.env.DOCKER_NAMESPACE ?? process.env.GITHUB_REPOSITORY_OWNER,
		})
	)
	.handle(handler);
