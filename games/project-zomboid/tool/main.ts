/**
 * Mount:
 * /home/steam/Zomboid
 * Saves:
 * /home/steam/Zomboid/Saves
 * Config ini:
 * /home/steam/Zomboid/Server/<server_name>.ini
 *
 *
 * Game Path:
 * /home/steam/Steam/steamapps/common/Project Zomboid Dedicated Server/start-server.sh
 *
 */

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
