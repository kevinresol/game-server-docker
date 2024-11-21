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
	proc.stdout.pipe(process.stdout);
	proc.stderr.pipe(process.stderr);

	// Intercept SIGINT/SIGTERM and send `autosavecancel` command to the server process
	// (autosavecancel = autosave then exit)
	function handleSignal(name: string) {
		return () => {
			console.log(`Intercepted ${name}, sending autosavecancel command...`);
			proc.stdin.write("autosavecancel\n");
			proc.on("exit", (code) => {
				console.log("Server process exited with code (autocancel): ", code);
				process.exit(code);
			});
		};
	}
	process.on("SIGINT", handleSignal("SIGINT"));
	process.on("SIGTERM", handleSignal("SIGTERM"));

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
