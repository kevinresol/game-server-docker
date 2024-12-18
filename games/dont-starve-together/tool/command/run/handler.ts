import { fileExists } from "@/common";
import { HandlerInput } from "@why-ts/cli";
import { spawn } from "node:child_process";
import { copyFile, writeFile } from "node:fs/promises";
import { Transform, TransformCallback } from "node:stream";
import { BaseArgs } from "../common";
import path from "node:path";

type Args = BaseArgs;

// ref: https://accounts.klei.com/assets/gamesetup/linux/run_dedicated_servers.sh
export default async function ({
	args: { binPath, dataPath },
}: HandlerInput<Args>) {
	const cluster = process.env.GAME_CLUSTER ?? "Cluster_1";

	ensureToken({ dataPath, cluster, token: process.env.GAME_CLUSTER_TOKEN });
	ensureFile({ dataPath, cluster, file: `cluster.ini` });
	ensureFile({ dataPath, cluster, file: `Master/server.ini` });
	ensureFile({ dataPath, cluster, file: `Caves/server.ini` });

	const command = `${binPath}/bin64/dontstarve_dedicated_server_nullrenderer_x64`;
	const args = [
		"-cluster",
		cluster,
		"-monitor_parent_process",
		process.pid.toString(),
	];

	const caves = spawn(command, args.concat(["-shard", "Caves"]));
	caves.stdout.pipe(new Prefixer("Caves")).pipe(process.stdout);
	caves.stderr.pipe(new Prefixer("Caves")).pipe(process.stderr);

	const master = spawn(command, args.concat(["-shard", "Master"]));
	master.stdout.pipe(new Prefixer("Master")).pipe(process.stdout);
	master.stderr.pipe(new Prefixer("Master")).pipe(process.stderr);

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

const TEMPLATE_PATH = "/home/steam/config";
async function ensureFile({
	dataPath,
	cluster,
	file,
}: {
	dataPath: string;
	cluster: string;
	file: string;
}) {
	const fullPath = path.join(dataPath, cluster, file);
	if (!(await fileExists(fullPath))) {
		await copyFile(path.join(TEMPLATE_PATH, file), fullPath);
	}
}

async function ensureToken({
	dataPath,
	cluster,
	token,
}: {
	dataPath: string;
	cluster: string;
	token?: string;
}) {
	const fullPath = path.join(dataPath, cluster, "cluster_token.txt");
	if (!(await fileExists(fullPath))) {
		if (token) {
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
		lines.forEach((line) => {
			this.push(`[${this.prefix}] ${line}\n`);
		});
		callback();
	}
}
