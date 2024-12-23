import { program } from "@why-ts/cli";
import configCommand from "./command/config/command";

(async () => {
	const output = await program({
		description: "Project Zomboid Dedicated Server Helper Tool",
	})
		.command("config", configCommand)
		.run(process.argv.slice(2))
		.catch(() => process.exit(1));
})();
