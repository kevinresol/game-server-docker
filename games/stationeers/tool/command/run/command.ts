import { option as o } from "@why-ts/cli";
import baseCommand from "../common";
import handler from "./handler";

export const RCON_DEFAULT_PORT = 27500;

export function validateRconOptionValue(value: string): true | string {
	if (value === "") {
		return true;
	}
	if (!/^[1-9]\d*$/.test(value)) {
		return "RCON port must be a decimal integer from 1 through 65535 with no sign, no leading zero, and no extra characters";
	}
	const port = Number(value);
	if (port > 65535) {
		return "RCON port must be between 1 and 65535";
	}
	return true;
}

const rconOption = o.string({
	description:
		"Enable Source RCON on the given TCP port. A bare --rcon listens on port 27500.",
	validate: validateRconOptionValue,
});

function configureRunCommand(base: typeof baseCommand) {
	return base
		.meta({
			description:
				'Run the game. Any arguments after "--" will be forwarded to the server executable. ' +
				"Commands written to stdin are delivered to the server console. " +
				"When --log-file is set, that same console output is also appended to the file. " +
				"Use --rcon to enable Source RCON; a bare --rcon listens on port 27500.",
		})
		.option(
			"log-file",
			o.string({
				description: "Append a copy of the server console output to this file.",
				fallback: () => process.env.GAME_LOG_FILE,
			}),
		)
		.option("rcon", rconOption);
}

const runCommand = configureRunCommand(baseCommand).handle(handler);

export default runCommand;

export async function parseRunArgsForTest(argv: string[]) {
	let args: Record<string, unknown> | undefined;
	await configureRunCommand(baseCommand)
		.handle(async (input) => {
			args = input.args as Record<string, unknown>;
		})
		.run(argv);
	return args!;
}
