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
	.handle(handler);
