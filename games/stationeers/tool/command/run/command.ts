import { option as o } from "@why-ts/cli";
import baseCommand from "../common";
import handler from "./handler";

// export type BaseArgs = {
// 	dataPath: string;
// 	serverName: string;
// };

export default baseCommand
	.meta({
		description:
			'Run the game. Any arguments after "--" will be forwarded to the server executable. ' +
			"This will also intercept SIGINT and perform autosave before quitting.",
	})
	.option(
		"log-file",
		o.string({
			description: "Path to the game log file.",
			fallback: () => process.env.GAME_LOG_FILE,
		})
	)
	.handle(handler);
