import { option as o } from "@why-ts/cli";
import baseCommand from "../common";
import handler from "./handler";

export default baseCommand
	.meta({ description: "Update ini config files" })
	.option(
		"file",
		o.string({
			required: true,
			description: "Config file to update.",
		})
	)
	.option(
		"value",
		o.dict({
			description:
				"Config values. Repeatable. (e.g. --value NETWORK.cluster_password=foobar --value NETWORK.cluster_name=MyServer",
		})
	)
	.option(
		"env-var-prefix",
		o.string({
			description:
				"If defined, environement variables with this prefix will be set as config. (Values specified via --value will take precedence). " +
				"Example: --env-var-prefix=DST_ will set NETWORK.cluster_password=foobar if DST_NETWORK__cluster_password=foo is defined in the environment." +
				"Double underscore __ in the environment variable name will be replaced by a dot . in the config path.",
		})
	)
	.option(
		"template-path",
		o.string({
			required: true,
			description: "Path to config templates.",
		})
	)
	.handle(handler);
