import { HandlerInput } from "@why-ts/cli";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import * as INI from "ini";
import path from "path";
import { env } from "process";
import { BaseArgs } from "../common";
import { fileExists } from "@/common";
import { peek } from "@why-ts/core";

type Args = BaseArgs & {
	value?: Map<string, string>;
	envVarPrefix?: string;
	file: string;
	templatePath: string;
};

export default async function ({
	args: { templatePath, dataPath, confDir, cluster, file, envVarPrefix, value },
	logger,
}: HandlerInput<Args>) {
	let modified = false;
	function set(obj: any, path: string, value: string) {
		logger.error(`Setting config: ${path}=${value}`);
		const keys = path.split(".");
		const lastKey = keys.pop()!;
		const lastObj = keys.reduce((obj, key) => (obj[key] = obj[key] ?? {}), obj);
		if (lastObj[lastKey] !== value) {
			lastObj[lastKey] = value;
			modified = true;
		}
	}

	logger.error("Update game config");
	const fullPath = path.join(dataPath, confDir, cluster, file);

	logger.error(`Reading config from ${fullPath}`);
	const config = await readConfig({
		templatePath,
		dataPath,
		confDir,
		cluster,
		file,
	});

	if (envVarPrefix) {
		for (const [key, val] of Object.entries(env)) {
			if (key.startsWith(envVarPrefix)) {
				const path = key.slice(envVarPrefix.length).replaceAll("__", ".");
				set(config, path, val ?? "");
			}
		}
	}

	if (value) {
		for (const [key, val] of value) {
			set(config, key, val);
		}
	}
	if (modified) {
		logger.error(`Writing config to ${fullPath}`);
		await writeConfig(fullPath, config);
	} else {
		logger.error("No changes");
	}
}

async function readConfig({
	templatePath,
	dataPath,
	cluster,
	confDir,
	file,
}: {
	templatePath: string;
	dataPath: string;
	confDir: string;
	cluster: string;
	file: string;
}) {
	try {
		const fullPath = path.join(dataPath, confDir, cluster, file);
		const content = await readFile(
			(await fileExists(fullPath)) ? fullPath : path.join(templatePath, file),
			"utf-8"
		);
		return peek(INI.parse(content));
	} catch (e) {
		console.error(e);
		return {};
	}
}

async function writeConfig(file: string, config: any) {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, INI.stringify(config));
}
