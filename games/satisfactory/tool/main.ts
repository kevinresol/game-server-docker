import { program } from "@why-ts/cli";

(async () => {
	const output = await program({
		description: "Satisfactory Dedicated Server Helper Tool",
	})
		.run(process.argv.slice(2))
		.catch(() => process.exit(1));
})();
