import { Readable } from "node:stream";
import {
	createConsoleReplyFramer,
	type ConsoleReplyFramer,
	type FramerClock,
	type FramerTimer,
} from "./framer";

/** Max wait for a stable idle prompt before failing the command (milliseconds). */
export const CONSOLE_REPLY_TIMEOUT_MS = 30_000;

const RECOVERY_SUBMITTED_LINE = "\u0000rcon-exchange-recovery\u0000";

const realClock: FramerClock = {
	now: () => Date.now(),
	setTimeout(fn, ms) {
		const handle = setTimeout(fn, ms);
		return { clear: () => clearTimeout(handle) };
	},
};

export type ConsoleExchange = {
	submit(body: string): Promise<string>;
};

export type CreateConsoleExchangeOptions = {
	stdout: NodeJS.ReadableStream;
	write(lineWithNewline: string): void;
	clock?: FramerClock;
};

/**
 * Serializes console commands: writes one line, frames stdout into the reply body.
 * Overlapping submits queue; a 30s timeout blocks further writes until a stable prompt.
 */
export function createConsoleExchange(
	options: CreateConsoleExchangeOptions,
): ConsoleExchange {
	const clock = options.clock ?? realClock;
	let commandRunning = false;
	const commandQueue: Array<{
		body: string;
		resolve: (reply: string) => void;
	}> = [];
	let recovering = false;
	let recoveryDone: Promise<void> = Promise.resolve();
	let stdoutClosed = false;
	let activeFramer: ConsoleReplyFramer | null = null;
	let recoveryFramer: ConsoleReplyFramer | null = null;

	function finishRecovery(): void {
		recovering = false;
		recoveryFramer = null;
	}

	function beginRecovery(): void {
		if (stdoutClosed) {
			finishRecovery();
			return;
		}
		recovering = true;
		recoveryFramer = createConsoleReplyFramer(RECOVERY_SUBMITTED_LINE, { clock });
		recoveryDone = recoveryFramer.done
			.finally(() => {
				finishRecovery();
			})
			.then(() => {});
	}

	function onStdoutData(chunk: Buffer | string): void {
		const data = typeof chunk === "string" ? chunk : chunk;
		if (recoveryFramer) {
			recoveryFramer.push(data);
			return;
		}
		if (activeFramer) {
			activeFramer.push(data);
		}
	}

	function onStdoutClosed(): void {
		if (stdoutClosed) return;
		stdoutClosed = true;
		activeFramer = null;
		recoveryFramer = null;
		finishRecovery();
	}

	options.stdout.on("data", onStdoutData);
	if (options.stdout instanceof Readable) {
		options.stdout.on("end", onStdoutClosed);
	}
	options.stdout.on("close", onStdoutClosed);

	function waitForStdoutClosed(): Promise<void> {
		if (stdoutClosed) return Promise.resolve();
		return new Promise((resolve) => {
			const done = () => {
				options.stdout.off("end", done);
				options.stdout.off("close", done);
				resolve();
			};
			options.stdout.once("end", done);
			options.stdout.once("close", done);
		});
	}

	async function runOne(body: string): Promise<string> {
		if (recovering) {
			await recoveryDone;
		}
		if (stdoutClosed) return "console closed";

		const framer = createConsoleReplyFramer(body, { clock });
		activeFramer = framer;
		options.write(`${body}\n`);

		let timeoutTimer: FramerTimer | undefined;
		const timeoutPromise = new Promise<"timeout">((resolve) => {
			timeoutTimer = clock.setTimeout(
				() => resolve("timeout"),
				CONSOLE_REPLY_TIMEOUT_MS,
			);
		});

		const outcome = await Promise.race([
			framer.done.then((text) => ({ kind: "ok" as const, text })),
			timeoutPromise.then(() => ({ kind: "timeout" as const })),
			waitForStdoutClosed().then(() => ({ kind: "closed" as const })),
		]);

		timeoutTimer?.clear();
		activeFramer = null;

		if (outcome.kind === "closed" || stdoutClosed) return "console closed";
		if (outcome.kind === "timeout") {
			beginRecovery();
			return "console reply timed out";
		}
		return outcome.text;
	}

	function pumpCommandQueue(): void {
		if (commandRunning || commandQueue.length === 0) return;
		const job = commandQueue.shift();
		if (!job) return;
		commandRunning = true;
		void (async () => {
			try {
				job.resolve(await runOne(job.body));
			} finally {
				commandRunning = false;
				pumpCommandQueue();
			}
		})();
	}

	return {
		submit(body: string): Promise<string> {
			if (stdoutClosed) return Promise.resolve("console closed");
			if (recovering) {
				return Promise.resolve("console reply timed out");
			}
			return new Promise((resolve) => {
				commandQueue.push({ body, resolve });
				pumpCommandQueue();
			});
		},
	};
}
