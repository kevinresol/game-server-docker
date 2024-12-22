import { program } from "@why-ts/cli";
import listDockerTagsCommand from "./command/list-docker-tags/command";
import buildGameImageCommand from "./command/build-game-image/command";
import buildGameToolCommand from "./command/build-game-tool/command";
import evalGameToolCommand from "./command/eval-game-tool/command";
import listSteamBranchesCommand from "./command/list-steam-branches/command";

(async () => {
	const output = await program({ description: "Game Server Docker Tool" })
		.command("list-docker-tags", listDockerTagsCommand)
		.command("list-steam-branches", listSteamBranchesCommand)
		.command("build-game-image", buildGameImageCommand)
		.command("build-game-tool", buildGameToolCommand)
		.command("eval-game-tool", evalGameToolCommand)
		.run(process.argv.slice(2))
		.catch((e) => {
			console.error(e);
			process.exit(1);
		});

	// console.log(output);
})();
