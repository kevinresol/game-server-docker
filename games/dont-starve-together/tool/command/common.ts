import { command, option as o } from "@why-ts/cli";

export type BaseArgs = {
	templatePath: string;
	binPath: string;
	dataPath: string;
	confDir: string;
	cluster: string;
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
		"conf-dir",
		o.string({
			required: true,
			description: "conf_dir",
			fallback: () => process.env.GAME_CONF_DIR ?? "DoNotStarveTogether",
		})
	)
	.option(
		"cluster",
		o.string({
			required: true,
			description: "Cluster name",
			fallback: () => process.env.GAME_CLUSTER ?? "Cluster_1",
		})
	);
