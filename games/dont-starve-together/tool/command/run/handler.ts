import { fileExists } from "@/common";
import { HandlerInput } from "@why-ts/cli";
import { spawn } from "node:child_process";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { Transform, TransformCallback } from "node:stream";
import { BaseArgs } from "../common";
import path from "node:path";

type Args = BaseArgs;

// ref: https://accounts.klei.com/assets/gamesetup/linux/run_dedicated_servers.sh
export default async function ({
	args: { binPath, dataPath, cluster, confDir, templatePath },
}: HandlerInput<Args>) {
	const common = { templatePath, dataPath, cluster, confDir };
	ensureToken({ ...common, token: process.env.GAME_CLUSTER_TOKEN });
	ensureFile({ ...common, file: `cluster.ini` });
	ensureFile({ ...common, file: `Master/server.ini` });
	ensureFile({ ...common, file: `Caves/server.ini` });

	const cwd = `${binPath}/bin`;
	const command = `${binPath}/bin64/dontstarve_dedicated_server_nullrenderer_x64`;
	const args = [
		"-console",
		"-monitor_parent_process",
		process.pid.toString(),
		"-persistent_storage_root",
		dataPath,
		"-conf_dir",
		confDir,
		"-cluster",
		cluster,
	];

	const caves = spawn(command, args.concat(["-shard", "Caves"]), { cwd });
	caves.stdout.pipe(new Prefixer("Caves ")).pipe(process.stdout);
	caves.stderr.pipe(new Prefixer("Caves ")).pipe(process.stderr);

	const master = spawn(command, args.concat(["-shard", "Master"]), { cwd });
	master.stdout.pipe(new Prefixer("Master")).pipe(process.stdout);
	master.stderr.pipe(new Prefixer("Master")).pipe(process.stderr);

	let terminated = false;
	const makeSignalHandler = (signal: string) => () => {
		console.log(`Received signal ${signal}`);
		if (terminated) return;
		terminated = true;
		console.log("Shutting down server...");
		master.stdin.write("c_shutdown()\n");
	};
	process.on("SIGTERM", makeSignalHandler("SIGTERM"));
	process.on("SIGINT", makeSignalHandler("SIGINT"));

	return new Promise<void>((resolve, reject) => {
		master.on("exit", (code) => {
			console.log("Server process exited with code: ", code);
			caves.kill();
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Game tool exited with code ${code}`));
			}
		});
	});
}

async function ensureFile({
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
	const fullPath = path.join(dataPath, confDir, cluster, file);
	if (!(await fileExists(fullPath))) {
		await mkdir(path.dirname(fullPath), { recursive: true });
		await copyFile(path.join(templatePath, file), fullPath);
	}
}

async function ensureToken({
	dataPath,
	cluster,
	confDir,
	token,
}: {
	dataPath: string;
	cluster: string;
	confDir: string;
	token?: string;
}) {
	const fullPath = path.join(dataPath, confDir, cluster, "cluster_token.txt");
	if (!(await fileExists(fullPath))) {
		if (token) {
			await mkdir(path.dirname(fullPath), { recursive: true });
			await writeFile(fullPath, token);
		} else {
			throw new Error(
				"Missing cluster token. Specify it via GAME_CLUSTER_TOKEN environment variable."
			);
		}
	}
}

class Prefixer extends Transform {
	constructor(private prefix: string) {
		super();
	}

	_transform(chunk: Buffer, encoding: string, callback: TransformCallback) {
		const lines = chunk.toString().split("\n");
		if (lines[lines.length - 1].trim() === "") lines.pop();
		lines.forEach((line) => {
			this.push(`[${this.prefix}] ${line}\n`);
		});
		callback();
	}
}
