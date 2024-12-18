import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export const isCI = process.env.CI === "true";

const GAMES_PATH = "./games";

export function getGamePath(game: string, ...rest: string[]) {
	return path.join(GAMES_PATH, game, ...rest);
}

export function getGameToolEntryPoint(game: string) {
	return getGamePath(game, "tool/main.ts");
}

export function getGameToolOutput(game: string) {
	return getGamePath(game, "dist/tool.js");
}

export async function getAllGames(): Promise<string[]> {
	const items = await readdir(GAMES_PATH);
	const isDir = await Promise.all(
		items.map((game) => stat(getGamePath(game)).then((s) => s.isDirectory()))
	);
	return items.filter((_, i) => isDir[i]);
}

export function shell(command: string, args: string[] = []) {
	console.log(`> ${command} ${args.join(" ")}`);

	return new Promise<void>((resolve, reject) => {
		const proc = spawn(command, args, { stdio: "inherit" });

		proc.on("exit", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Command exited with code ${code}`));
			}
		});
	});
}

export async function fileExists(file: string) {
	try {
		return (await stat(file)).isFile();
	} catch {
		return false;
	}
}
