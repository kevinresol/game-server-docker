import { HandlerInput } from "@why-ts/cli";
import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import fs from "node:fs";

const DEFAULT_PTY_BIN = "/home/steam/shim/stn-pty";
const SHIM_LIBRARY = "/home/steam/shim/libkernel32-shim.so";

type Args = {
	binPath: string;
	logFile?: string;
};

// Prepend the shim unless it is already one of the colon-separated paths.
// The copy is passed only to the spawned stn-pty process.
function ldPreloadForChild(existing: string | undefined): string {
	if (!existing) return SHIM_LIBRARY;
	const parts = existing.split(":").filter((part) => part.length > 0);
	if (parts.includes(SHIM_LIBRARY)) return parts.join(":");
	return [SHIM_LIBRARY, ...parts].join(":");
}

export default async function ({
	args: { binPath, logFile, "--": forwarded },
}: HandlerInput<Args>) {
	const gameArgs = [...(forwarded ?? [])];
	if (gameArgs.some((arg) => arg.toLowerCase() === "-logfile")) {
		throw new Error(
			"Do not specify -logfile manually in the rest arguments, use the --log-file flag or GAME_LOG_FILE env var instead.",
		);
	}
	if (!gameArgs.includes("-noclear")) {
		gameArgs.push("-noclear");
	}

	if (logFile) {
		await appendFile(logFile, ""); // make sure the log file exists; output is appended later
	}

	const ptyBin = process.env.STN_PTY_BIN ?? DEFAULT_PTY_BIN;
	const gameBinary = `${binPath}/rocketstation_DedicatedServer.x86_64`;
	const proc = spawn(ptyBin, [gameBinary, ...gameArgs], {
		stdio: ["inherit", "pipe", "pipe"],
		env: {
			...process.env,
			LD_PRELOAD: ldPreloadForChild(process.env.LD_PRELOAD),
		},
	});

	// Docker stop sends SIGTERM. Unity handles SIGINT; stn-pty forwards it to the game.
	process.on("SIGTERM", () => proc.kill("SIGINT"));

	if (!proc.stdout || !proc.stderr) {
		proc.kill("SIGKILL");
		throw new Error("stn-pty stdout and stderr must be pipes");
	}

	// Identical bytes: helper stdout is copied unchanged to process.stdout and,
	// when --log-file is set, appended to that file. No CR or escape stripping.
	if (logFile) {
		const teePath = logFile;
		proc.stdout.on("data", (chunk: Buffer | string) => {
			try {
				fs.appendFileSync(teePath, chunk);
			} catch (e) {
				console.error(`Failed to write the log file: ${e}`);
			}
		});
	}
	proc.stdout.pipe(process.stdout);
	proc.stderr.pipe(process.stderr);

	return new Promise<void>((resolve, reject) => {
		// "close" fires after stdout/stderr have ended, so the last bytes are
		// in the tee file before it is deleted. "exit" can run earlier.
		proc.on("close", (code) => {
			console.log("Server process exited with code: ", code);

			try {
				if (logFile) fs.unlinkSync(logFile); // delete the log file after the server process exits
			} catch (e) {
				console.error(`Failed to delete the log file: ${e}`);
			}

			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Game tool exited with code ${code}`));
			}
		});
	});
}
