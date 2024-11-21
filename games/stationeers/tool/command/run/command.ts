import handler from "./handler";
import baseCommand from "../common";

export type BaseArgs = {
	dataPath: string;
	serverName: string;
};

export default baseCommand
	.meta({
		description:
			'Run the game. Any arguments after "--" will be forwarded to the server executable. ' +
			"This will also intercept SIGINT and perform autosave before quitting.",
	})
	.handle(handler);
