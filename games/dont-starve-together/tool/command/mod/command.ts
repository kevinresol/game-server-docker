import { option as o } from "@why-ts/cli";
import baseCommand from "../common";
import handler from "./handler";

export default baseCommand
	.meta({ description: "Install mods" })
	.option(
		"ids",
		o.string({
			description: "Comma separated list of mod ids",
			fallback: () => process.env.DST_MOD_IDS,
		})
	)
	.handle(handler);
