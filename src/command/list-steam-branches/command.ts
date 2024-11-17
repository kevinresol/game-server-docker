import { command, option as o } from "@why-ts/cli";
import handler from "./handler";

export default command({ description: "Get Steam Build ID" })
	.option(
		["appId", "a"],
		o.number({ required: true, description: "Steam App ID" })
	)
	.option(
		["branch", "b"],
		o.string({
			required: true,
			description: "Steam Branch",
			fallback: () => "public",
		})
	)
	.handle(handler);
