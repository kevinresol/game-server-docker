import { command, option as o } from "@why-ts/cli";

export type BaseArgs = {
	binPath: string;
	dataPath: string;
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
	);
