import { program } from "@why-ts/cli";
import configCommand from "./command/config/command";
import runCommand from "./command/run/command";
import modCommand from "./command/mod/command";

(async () => {
	const output = await program({
		description: "Don't Starve Together Dedicated Server Helper Tool",
	})
		.command("config", configCommand)
		.command("mod", modCommand)
		.command("run", runCommand)
		.run(process.argv.slice(2))
		.catch(() => process.exit(1));

	process.exit(0);
})();
