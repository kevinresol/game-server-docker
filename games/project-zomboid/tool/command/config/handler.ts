import { HandlerInput } from "@why-ts/cli";
import { readFile, stat, writeFile } from "fs/promises";
import * as INI from "ini";
import path from "path";
import { env } from "process";
import { BaseArgs } from "../common";

type Args = BaseArgs & {
	value?: Map<string, string>;
	envVarPrefix?: string;
};

export default async function ({
	args: { dataPath, serverName, envVarPrefix, value },
	logger,
}: HandlerInput<Args>) {
	function set(obj: any, path: string, value: string) {
		logger.error(`Setting config: ${path}=${value}`);
		const keys = path.split(".");
		const lastKey = keys.pop()!;
		const lastObj = keys.reduce((obj, key) => (obj[key] = obj[key] ?? {}), obj);
		lastObj[lastKey] = value;
	}

	logger.error("Update game config");

	const file = path.join(dataPath, "Server", `${serverName}.ini`);

	logger.error(`Reading config from ${file}`);
	const config = readConfig(file);

	if (envVarPrefix) {
		for (const [key, val] of Object.entries(env)) {
			if (key.startsWith(envVarPrefix)) {
				set(config, key.slice(envVarPrefix.length), val ?? "");
			}
		}
	}

	if (value) {
		for (const [key, val] of value) {
			set(config, key, val);
		}
	}

	logger.error(`Writing config to ${file}`);
	await writeConfig(file, config);
}

async function readConfig(file: string) {
	const content = await readFile(
		(await stat(file)).isFile() ? file : "/home/steam/default.ini",
		"utf-8"
	);
	return INI.parse(content);
}

async function writeConfig(file: string, config: any) {
	await writeFile(file, INI.stringify(config));
}
