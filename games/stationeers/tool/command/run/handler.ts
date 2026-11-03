import { HandlerInput } from "@why-ts/cli";
import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import fs from "node:fs";
import { Readable, type Writable } from "node:stream";
import { RCON_DEFAULT_PORT, validateRconOptionValue } from "./command";
import { createConsoleExchange } from "./rcon/exchange";
import { createRconServer, type RconServerHandle } from "./rcon/server";
import { readServerAuthSecret } from "./rcon/secret";
import { startPlayerLog } from "./playerlog";

const DEFAULT_PTY_BIN = "/home/steam/shim/stn-pty";
const SHIM_LIBRARY = "/home/steam/shim/libkernel32-shim.so";

type Args = {
	binPath: string;
	logFile?: string;
	preShutdown?: string;
	rcon?: string;
};

type ParentStdinBridge = {
	waitForLineBoundary: () => Promise<void>;
	hold: () => void;
	release: () => void;
	dispose: () => void;
};

function resolveRconPort(rcon: string | undefined): number | undefined {
	if (rcon === undefined) {
		return undefined;
	}
	const validation = validateRconOptionValue(rcon);
	if (validation !== true) {
		throw new Error(validation);
	}
	return rcon === "" ? RCON_DEFAULT_PORT : Number(rcon);
}

function readSecretForRcon(installDir: string, gameArgs: readonly string[]) {
	const result = readServerAuthSecret(installDir, gameArgs, (filePath) => {
		try {
			return fs.readFileSync(filePath, "utf8");
		} catch {
			return undefined;
		}
	});
	if (result.ok) {
		return { ok: true as const, secret: result.secret };
	}
	return { ok: false as const };
}

// Prepend the shim unless it is already one of the colon-separated paths.
// The copy is passed only to the spawned stn-pty process.
function ldPreloadForChild(existing: string | undefined): string {
	if (!existing) return SHIM_LIBRARY;
	const parts = existing.split(":").filter((part) => part.length > 0);
	if (parts.includes(SHIM_LIBRARY)) return parts.join(":");
	return [SHIM_LIBRARY, ...parts].join(":");
}

export default async function ({
	args: { binPath, logFile, preShutdown, rcon, "--": forwarded },
}: HandlerInput<Args>) {
	void preShutdown;
	const gameArgs = [...(forwarded ?? [])];
	const rconPort = resolveRconPort(rcon);
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

	let rconServer: RconServerHandle | undefined;
	let consoleExchange: ReturnType<typeof createConsoleExchange> | undefined;
	let stdinBridge: ParentStdinBridge | undefined;
	let rconInflight: Promise<string> | undefined;
	if (rconPort !== undefined) {
		const readSecret = () => readSecretForRcon(binPath, gameArgs);
		try {
			rconServer = await createRconServer({
				port: rconPort,
				readSecret,
				execute: (body) => {
					if (!consoleExchange || !stdinBridge) {
						throw new Error("RCON console exchange is not ready");
					}
					const bridge = stdinBridge;
					const exchange = consoleExchange;
					const run = (async () => {
						await bridge.waitForLineBoundary();
						bridge.hold();
						try {
							return await exchange.submit(body);
						} finally {
							bridge.release();
						}
					})();
					rconInflight = run;
					void run.finally(() => {
						if (rconInflight === run) rconInflight = undefined;
					});
					return run;
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to bind RCON on port ${rconPort}: ${message}`);
		}
	}

	const ptyBin = process.env.STN_PTY_BIN ?? DEFAULT_PTY_BIN;
	const gameBinary = `${binPath}/rocketstation_DedicatedServer.x86_64`;
	const proc = spawn(ptyBin, [gameBinary, ...gameArgs], {
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			LD_PRELOAD: ldPreloadForChild(process.env.LD_PRELOAD),
		},
	});

	const childIn = proc.stdin;
	const childOut = proc.stdout;
	const childErr = proc.stderr;
	if (!childIn || !childOut || !childErr) {
		proc.kill("SIGKILL");
		throw new Error("stn-pty stdin, stdout, and stderr must be pipes");
	}

	// Docker stop is SIGTERM at PID 1, then here. Ctrl+C is SIGINT at PID 1, then here.
	// The dedicated server exits on the console command. Signaling stn-pty would
	// deliver SIGINT to the game instead, so these handlers only write "quit".
	// Parent stdin stays open after EOF so a later quit can still be written.
	const parentIn = process.stdin;
	childIn.on("error", onChildStdinError);
	stdinBridge =
		rconPort !== undefined ? createParentStdinBridge(parentIn, childIn) : undefined;
	if (!stdinBridge) {
		parentIn.pipe(childIn, { end: false });
	}
	if (typeof parentIn.unref === "function") parentIn.unref();

	const writeConsoleLine = (lineWithNewline: string): void => {
		if (childIn.destroyed || childIn.writableEnded) return;
		childIn.write(lineWithNewline, (error) => {
			if (error) onChildStdinError(error);
		});
	};

	const waitForRconIdle = async (): Promise<void> => {
		if (rconInflight) await rconInflight;
	};

	const beginShutdown = createConsoleQuitShutdown({
		waitBeforeQuit: waitForRconIdle,
		writeQuitLine: () => writeConsoleLine("quit\n"),
	});
	process.on("SIGTERM", () => {
		void beginShutdown();
	});
	process.on("SIGINT", () => {
		void beginShutdown();
	});

	if (rconServer) {
		consoleExchange = createConsoleExchange({
			stdout: childOut,
			write: writeConsoleLine,
		});
	}

	// One write path. A byte is appended to --log-file only from the stdout
	// write callback, so a chunk process.stdout has not accepted cannot land
	// in the file first. Stderr is not part of that path. No CR or escape stripping.
	const stdoutFlush = forwardStdout(childOut, logFile);
	childErr.pipe(process.stderr);

	// Unity's Player.log is separate from the --log-file tee. startPlayerLog
	// returns immediately; stop() on close does not wait out the 30s discovery.
	const playerLog = startPlayerLog();

	return new Promise<void>((resolve, reject) => {
		// "close" fires after stdout/stderr have ended, so the last bytes are
		// in the tee file before it is deleted. "exit" can run earlier.
		proc.on("close", (code) => {
			if (stdinBridge) {
				stdinBridge.dispose();
			} else {
				parentIn.unpipe(childIn);
				parentIn.pause();
			}
			playerLog.stop();
			const rconClose = rconServer?.close().catch((error) => {
				console.error(`Failed to close RCON server: ${error}`);
			});
			void Promise.all([stdoutFlush, rconClose]).then(() => {
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
	});
}

function onChildStdinError(error: Error | null | undefined): void {
	if (!error) return;
	const code = (error as NodeJS.ErrnoException).code;
	if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") return;
	console.error(`Failed to write server stdin: ${error}`);
}

/** Single-flight console shutdown (quit line). T2 wraps this after an optional pre-shutdown hook. */
export function createConsoleQuitShutdown(options: {
	waitBeforeQuit: () => Promise<void>;
	writeQuitLine: () => void;
}): () => Promise<void> {
	let flight: Promise<void> | undefined;
	return () => {
		if (!flight) {
			flight = options.waitBeforeQuit().then(() => {
				options.writeQuitLine();
			});
		}
		return flight;
	};
}

function createParentStdinBridge(parentIn: NodeJS.ReadableStream, childIn: Writable): ParentStdinBridge {
	let partialLine = false;
	let held = false;
	const lineBoundaryWaiters: Array<() => void> = [];

	const notifyLineBoundary = (): void => {
		if (partialLine) return;
		const waiters = lineBoundaryWaiters.splice(0);
		for (const resolve of waiters) resolve();
	};

	const noteForwardedBytes = (chunk: Buffer): void => {
		for (let i = 0; i < chunk.length; i++) {
			const byte = chunk[i];
			if (byte === 0x0a) {
				partialLine = false;
			} else if (byte !== 0x0d) {
				partialLine = true;
			}
		}
		notifyLineBoundary();
	};

	const onParentData = (chunk: Buffer | string): void => {
		if (held) return;
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		noteForwardedBytes(buf);
		if (childIn.destroyed || childIn.writableEnded) return;
		childIn.write(buf, (error) => {
			if (error) onChildStdinError(error);
		});
	};

	parentIn.on("data", onParentData);
	parentIn.on("end", () => {
		// Parent EOF must not close the server console; quit may follow.
	});
	if (typeof parentIn.resume === "function") parentIn.resume();

	return {
		waitForLineBoundary(): Promise<void> {
			if (!partialLine) return Promise.resolve();
			return new Promise((resolve) => {
				lineBoundaryWaiters.push(resolve);
			});
		},
		hold(): void {
			held = true;
			if (typeof parentIn.pause === "function") parentIn.pause();
		},
		release(): void {
			held = false;
			if (typeof parentIn.resume === "function") parentIn.resume();
		},
		dispose(): void {
			parentIn.off("data", onParentData);
			if (typeof parentIn.pause === "function") parentIn.pause();
		},
	};
}

// Helper stdout is written only through process.stdout.write. The log file is
// updated inside that write's callback, after the sink has accepted the chunk.
// A false return pauses the helper so a stalled stdout cannot leave the file ahead.
function forwardStdout(source: Readable, logFile: string | undefined): Promise<void> {
	let pending = 0;
	let ended = false;
	let notify: (() => void) | undefined;

	const settled = () => {
		if (!ended || pending !== 0) return;
		notify?.();
		notify = undefined;
	};

	source.on("end", () => {
		ended = true;
		settled();
	});
	source.on("data", (chunk: Buffer | string) => {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		pending += 1;
		let finished = false;
		const onWritten = (error?: Error | null) => {
			if (finished) return;
			finished = true;
			if (!error && logFile) {
				try {
					fs.appendFileSync(logFile, buf);
				} catch (e) {
					console.error(`Failed to write the log file: ${e}`);
				}
			}
			pending -= 1;
			settled();
		};
		try {
			const queued = process.stdout.write(buf, onWritten);
			if (!queued) {
				source.pause();
				process.stdout.once("drain", () => {
					source.resume();
				});
			}
		} catch (e) {
			console.error(`Failed to write stdout: ${e}`);
			onWritten(e instanceof Error ? e : new Error(String(e)));
		}
	});

	return new Promise((resolve) => {
		notify = resolve;
		settled();
	});
}
