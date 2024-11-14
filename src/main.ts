import { program } from "@why-ts/cli";
import listTagsCommand from "./command/list-tags/command";

(async () => {
	const output = await program({ description: "Game Server Docker Tool" })
		.command("list-tags", listTagsCommand)
		.run(process.argv.slice(2))
		.catch(() => process.exit(1));
})();
