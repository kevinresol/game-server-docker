import { option as o } from "@why-ts/cli";
import baseCommand from "../common";
import handler from "./handler";

export default baseCommand
	.meta({
		description:
			'Run the game. Any arguments after "--" will be forwarded to the server executable. ' +
			"Commands written to stdin are delivered to the server console. " +
			"When --log-file is set, that same console output is also appended to the file.",
	})
	.option(
		"log-file",
		o.string({
			description: "Append a copy of the server console output to this file.",
			fallback: () => process.env.GAME_LOG_FILE,
		})
	)
	.handle(handler);
