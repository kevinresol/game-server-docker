import { command, option as o } from "@why-ts/cli";
import handler from "./handler";

export default command({ description: "Build Game Tool" })
	.option(
		["game", "g"],
		o.string({
			required: true,
			description: "Game folder. Use --all to build all games.",
		})
	)
	.handle(handler);
