import { option as o } from "@why-ts/cli";
import baseCommand from "../common";
import handler from "./handler";

export default baseCommand
	.meta({ description: "Update Game Config" })
	.option(
		"value",
		o.dict({
			description:
				"Config values. Repeatable. (e.g. --value=PVP=true --value=PauseEmpty=true",
		})
	)
	.option(
		"env-var-prefix",
		o.string({
			description:
				"If defined, environement variables with this prefix will be set as config. (Values specified via --value will take precedence). " +
				"Example: --env-var-prefix=PZ_ will set PVP=true if PZ_PVP is defined in the environment.",
		})
	)
	.handle(handler);
