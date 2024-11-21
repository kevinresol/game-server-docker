import { program } from "@why-ts/cli";
import runCommand from "./command/run/command";

(async () => {
	const output = await program({
		description: "Stationeers Dedicated Server Helper Tool",
	})
		.command("run", runCommand)
		.run(process.argv.slice(2))
		.catch(() => process.exit(1));
})();
