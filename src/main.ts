import { program } from "@why-ts/cli";
import listDockerTagsCommand from "./command/list-docker-tags/command";
import buildCommand from "./command/build/command";
import getSteamBuildIdCommand from "./command/get-steam-build-id/command";

(async () => {
	const output = await program({ description: "Game Server Docker Tool" })
		.command("list-docker-tags", listDockerTagsCommand)
		.command("get-steam-build-id", getSteamBuildIdCommand)
		.command("build", buildCommand)
		.run(process.argv.slice(2))
		.catch(() => process.exit(1));
})();
