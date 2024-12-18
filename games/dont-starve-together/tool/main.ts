import { program } from "@why-ts/cli";
import configCommand from "./command/config/command";

(async () => {
	const output = await program({
		description: "Don't Starve Together Dedicated Server Helper Tool",
	})
		.command("config", configCommand)
		.run(process.argv.slice(2))
		.catch(() => process.exit(1));
})();
