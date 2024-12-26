import { HandlerInput } from "@why-ts/cli";
import { writeFile } from "fs/promises";
import path from "path";
import { BaseArgs } from "../common";

type Args = BaseArgs & {
	ids?: string;
};

// https://forums.kleientertainment.com/forums/topic/96433-dedicated-server-mod-setup-guide/
export default async function ({ args, logger }: HandlerInput<Args>) {
	if (args.ids) {
		const ids = args.ids.split(",");
		logger.error(`Setting up mods: ${ids.join(", ")}`);

		const lua = ids.map((id) => `ServerModSetup("${id}")`).join("\n");
		const fullPath = path.join(
			args.binPath,
			"mods",
			"dedicated_server_mods_setup.lua"
		);

		logger.error(`Writing mods setup to ${fullPath}:`);
		logger.error(lua);

		await writeFile(fullPath, lua);

		console.error(
			"To enable the mods, you need add the following script to <DST_Save_folder>/<Cluster_folder>/<shard_folder>/modoverrides.lua"
		);

		console.log(`return {
	${ids.map((id) => `["workshop-${id}"] = { enabled = true}`).join(",\n\t")}
}`);
	} else {
		logger.error("No mods to setup");
	}
}
