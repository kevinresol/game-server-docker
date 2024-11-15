import { command, option as o } from "@why-ts/cli";

export type BaseArgs = {
	dataPath: string;
	serverName: string;
};

export default command()
	.option(
		"bin-path",
		o.string({
			required: true,
			description: "Path to the game binary folder.",
			fallback: () => process.env.GAME_BIN_PATH,
		})
	)
	.option(
		"data-path",
		o.string({
			required: true,
			description: "Path to the game data folder.",
			fallback: () => process.env.GAME_DATA_PATH,
		})
	)
	.option(
		"server-name",
		o.string({
			required: true,
			description:
				"Game server name. Will affect the config file name to be loaded.",
			fallback: () => process.env.SERVER_NAME,
		})
	);
