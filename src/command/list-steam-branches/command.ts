import { command, option as o } from "@why-ts/cli";
import handler from "./handler";

export default command({ description: "Get Steam Build ID" })
	.option(
		["appId", "a"],
		o.number({ required: true, description: "Steam App ID" })
	)
	.handle(handler);
