import { HandlerInput } from "@why-ts/cli";
import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { match } from "ts-pattern";

type Args = {
	binPath: string;
	logFile?: string;
};
export default async function ({
	args: { binPath, logFile, "--": args },
}: HandlerInput<Args>) {
	if (logFile) {
		await match(args.findIndex((arg) => arg.toLowerCase() === "-logfile"))
			.with(-1, () => {
				args.push("-logfile", logFile);
				return appendFile(logFile, ""); // make sure log file exists so we can tail it later
			})
			.otherwise(() => {
				throw new Error(
					"Do not specify -logfile manually in the rest arguments, use the --log-file flag or GAME_LOG_FILE env var instead."
				);
			});
	}

	const proc = spawn(`${binPath}/rocketstation_DedicatedServer.x86_64`, args);

	// pipe the server process output to the console
	proc.stdout.pipe(process.stdout);
	proc.stderr.pipe(process.stderr);

	// let quitting = false;
	// Intercept SIGINT/SIGTERM and send `autosavecancel` command to the server process
	// (autosavecancel = autosave then exit)
	// function makdSignalHandler(name: string) {
	// 	return () => {
	// 		console.log(`Intercepted ${name}`);
	// 		if (quitting) return;
	// 		console.log(`Sending autosavecancel command...`);
	// 		quitting = true;
	// 		proc.stdin.write("autosavecancel\n");
	// 		proc.on("exit", (code) => {
	// 			console.log("Server process exited with code (autocancel): ", code);
	// 			process.exit(code);
	// 		});
	// 	};
	// }

	// console.log(`Registering signal handlers...`);
	// process.on("SIGINT", makdSignalHandler("SIGINT"));
	process.on("SIGTERM", () => proc.kill("SIGINT")); // forwards SIGTERM to the server process as SIGINT as Unity only hanldes SIGINT

	// tail the log file if specified
	const log = match(logFile)
		.with(undefined, () => undefined)
		.otherwise((v) => {
			try {
				const proc = spawn("tail", ["-f", v]);
				proc.stdout.pipe(process.stdout);
				proc.stderr.pipe(process.stderr);
				return proc;
			} catch (e) {
				console.error(`Failed to tail the log file: ${e}`);
				return undefined;
			}
		});

	return new Promise<void>((resolve, reject) => {
		proc.on("exit", (code) => {
			console.log("Server process exited with code: ", code);

			if (log) log.kill();

			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Game tool exited with code ${code}`));
			}
		});
	});
}
