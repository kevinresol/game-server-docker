import { HandlerInput } from "@why-ts/cli";
import { spawn } from "node:child_process";

type Args = {
	binPath: string;
};
export default function ({ args }: HandlerInput<Args>) {
	const proc = spawn(
		`${args.binPath}/rocketstation_DedicatedServer.x86_64`,
		args["--"]
	);

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

	proc.stdout.pipe(process.stdout);
	proc.stderr.pipe(process.stderr);

	return new Promise<void>((resolve, reject) => {
		proc.on("exit", (code) => {
			console.log("Server process exited with code: ", code);
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Game tool exited with code ${code}`));
			}
		});
	});
}
