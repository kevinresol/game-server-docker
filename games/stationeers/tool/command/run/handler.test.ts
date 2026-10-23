import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, test } from "node:test";
import handler from "./handler";

// C2 rule: identical bytes. Helper stdout is written to process.stdout and, when
// --log-file is set, appended to that file with no CR or escape-sequence stripping.

const SHIM_LIBRARY = "/home/steam/shim/libkernel32-shim.so";

const PAYLOAD = Buffer.concat([
	Buffer.from("Ready\r\n", "utf8"),
	Buffer.from("\x1b[0m", "utf8"),
	Buffer.from("still-here\r\nTAIL\n", "utf8"),
]);
const DIAGNOSTIC = Buffer.from("pty-stderr");

type Report = {
	argv: string[];
	ldPreload: string | null;
	stdin: { dev: string; ino: string; matchesParentStdin: boolean };
};

type Started = {
	dir: string;
	gamePath: string;
	logFile?: string;
	result: Promise<void>;
	settled: () => boolean;
	stdout: () => Buffer;
	stderr: () => Buffer;
	refusedStdout: () => number;
	releaseRefusedStdout: () => void;
	logSnapshot: () => Buffer | null;
	logs: () => unknown[][];
	readReport: () => Report;
	releaseWait: () => void;
	releaseExit: () => void;
	childEvents: string[];
	signalPath: string;
	gameSignalPath: string;
	readyPath: string;
	cleanup: () => Promise<void>;
};

function writeExecutable(file: string, body: string): void {
	const contents = `#!${process.execPath}\n${body}`;
	fs.writeFileSync(file, contents, { mode: 0o755 });
	fs.chmodSync(file, 0o755);
}

function parentStdinIdentity(): { dev: string; ino: string } {
	const stat = fs.fstatSync(0);
	return { dev: String(stat.dev), ino: String(stat.ino) };
}

function waitFor(predicate: () => boolean, label: string): Promise<void> {
	const deadline = Date.now() + 4000;
	return new Promise((resolve, reject) => {
		const tick = () => {
			if (predicate()) {
				resolve();
				return;
			}
			if (Date.now() > deadline) {
				reject(new Error(`timed out waiting for ${label}`));
				return;
			}
			setTimeout(tick, 10);
		};
		tick();
	});
}

function killPidFile(file: string): void {
	if (!fs.existsSync(file)) return;
	const pid = Number(fs.readFileSync(file, "utf8"));
	if (!Number.isInteger(pid) || pid <= 0) return;
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// The process has already exited.
	}
}

function spyChildLifecycle(): { events: string[]; restore: () => void } {
	const events: string[] = [];
	const original = ChildProcess.prototype.on as (
		this: ChildProcess,
		event: string | symbol,
		listener: (...args: unknown[]) => void,
	) => ChildProcess;
	ChildProcess.prototype.on = function (
		this: ChildProcess,
		event: string | symbol,
		listener: (...args: unknown[]) => void,
	): ChildProcess {
		if (event === "exit" || event === "close") events.push(String(event));
		return original.call(this, event, listener);
	} as typeof ChildProcess.prototype.on;
	return {
		events,
		restore() {
			ChildProcess.prototype.on = original as typeof ChildProcess.prototype.on;
		},
	};
}

// Stdout is whatever process.stdout.write accepts. A chunk the sink refuses is
// absent from stdout() and must not be appended to --log-file. Stderr is still
// recorded from the pipe. String writes (the test runner) are ignored.
function tapStdioPipes(acceptStdout?: (chunk: Buffer, index: number) => boolean): {
	stdout: () => Buffer;
	stderr: () => Buffer;
	refusedStdout: () => number;
	releaseRefusedStdout: () => void;
	restore: () => void;
} {
	const stdoutChunks: Buffer[] = [];
	const stderrChunks: Buffer[] = [];
	const refused: Array<{ callback?: (error?: Error | null) => void }> = [];
	// Buffers emitted by a child stdout. The test runner writes other buffers
	// to process.stdout; those are not the helper sink.
	const helperChunks = new Set<Buffer>();
	const originalPipe = Readable.prototype.pipe;
	// Node's public types omit the internal ChildProcess.spawn used by spawn().
	const childProto = ChildProcess.prototype as unknown as {
		spawn: (this: ChildProcess, ...args: unknown[]) => unknown;
	};
	const originalChildSpawn = childProto.spawn;
	const originalStdoutWrite = process.stdout.write as unknown as (
		chunk: string | Uint8Array,
		encoding?: BufferEncoding | ((error?: Error | null) => void),
		cb?: (error?: Error | null) => void,
	) => boolean;
	childProto.spawn = function (this: ChildProcess, ...args: unknown[]): unknown {
		const result = originalChildSpawn.apply(this, args);
		this.stdout?.on("data", (chunk: Buffer | string) => {
			if (Buffer.isBuffer(chunk)) helperChunks.add(chunk);
		});
		return result;
	};
	Readable.prototype.pipe = function (
		this: Readable,
		dest: NodeJS.WritableStream,
		options?: { end?: boolean },
	) {
		if (dest === process.stderr) {
			this.on("data", (chunk: Buffer | string) => {
				stderrChunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk));
			});
		}
		return originalPipe.call(this, dest, options);
	} as typeof Readable.prototype.pipe;
	process.stdout.write = function (
		this: NodeJS.WriteStream,
		chunk: string | Uint8Array,
		encoding?: BufferEncoding | ((error?: Error | null) => void),
		cb?: (error?: Error | null) => void,
	): boolean {
		const callback = typeof encoding === "function" ? encoding : cb;
		if (!Buffer.isBuffer(chunk) || !helperChunks.has(chunk)) {
			if (typeof encoding === "function") {
				return originalStdoutWrite.call(process.stdout, chunk, encoding);
			}
			return originalStdoutWrite.call(process.stdout, chunk, encoding as BufferEncoding, cb);
		}
		helperChunks.delete(chunk);
		const buf = Buffer.from(chunk);
		const index = stdoutChunks.length + refused.length;
		if (acceptStdout && !acceptStdout(buf, index)) {
			refused.push({ callback });
			return false;
		}
		stdoutChunks.push(buf);
		if (callback) return originalStdoutWrite.call(process.stdout, buf, callback);
		return originalStdoutWrite.call(process.stdout, buf);
	} as typeof process.stdout.write;
	return {
		stdout: () => Buffer.concat(stdoutChunks),
		stderr: () => Buffer.concat(stderrChunks),
		refusedStdout: () => refused.length,
		releaseRefusedStdout() {
			const pending = refused.splice(0);
			for (const item of pending) item.callback?.();
			process.stdout.emit("drain");
		},
		restore() {
			Readable.prototype.pipe = originalPipe;
			childProto.spawn = originalChildSpawn;
			process.stdout.write = originalStdoutWrite;
		},
	};
}

function startRun(options: {
	args?: string[];
	useLogFile?: boolean;
	mode: "exit" | "output" | "output-wait" | "output-split" | "wait" | "signal";
	exitCode?: number;
	payload?: Buffer;
	cut?: number;
	ldPreload?: string;
	acceptStdout?: (chunk: Buffer, index: number) => boolean;
}): Started {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stn-s5-"));
	const binPath = path.join(dir, "game");
	fs.mkdirSync(binPath);
	const gamePath = path.join(binPath, "rocketstation_DedicatedServer.x86_64");
	const helperPath = path.join(dir, "stn-pty");
	const reportPath = path.join(dir, "report.json");
	const payloadPath = path.join(dir, "payload.bin");
	const readyPath = path.join(dir, "ready");
	const releasePath = path.join(dir, "release");
	const signalPath = path.join(dir, "helper-signal");
	const gameSignalPath = path.join(dir, "game-signal");
	const helperPidPath = path.join(dir, "helper.pid");
	const gamePidPath = path.join(dir, "game.pid");
	const exitPath = path.join(dir, "exit");
	const logFile = options.useLogFile ? path.join(dir, "stationeers.log") : undefined;
	const stdin = parentStdinIdentity();
	if (options.payload) fs.writeFileSync(payloadPath, options.payload);

	writeExecutable(
		gamePath,
		`
const fs = require("node:fs");
const mode = process.env.STN_FAKE_MODE;
const exitCode = Number(process.env.STN_FAKE_EXIT || "0");
if (mode === "output" || mode === "output-wait" || mode === "output-split") {
  const payload = fs.readFileSync(process.env.STN_FAKE_PAYLOAD);
  const cut = mode === "output-split" ? Number(process.env.STN_FAKE_CUT || "0") : payload.length;
  fs.writeSync(1, payload.subarray(0, cut));
  fs.writeSync(2, Buffer.from("pty-stderr"));
  if (mode === "output") process.exit(exitCode);
  fs.writeFileSync(process.env.STN_FAKE_READY, "ready");
  const release = process.env.STN_FAKE_RELEASE;
  const timer = setInterval(() => {
    if (!fs.existsSync(release)) return;
    clearInterval(timer);
    if (mode === "output-split") {
      fs.writeSync(1, payload.subarray(cut));
      fs.writeFileSync(process.env.STN_FAKE_READY, "second");
      const exitFile = process.env.STN_FAKE_EXIT_FILE;
      const exitTimer = setInterval(() => {
        if (!fs.existsSync(exitFile)) return;
        clearInterval(exitTimer);
        process.exit(exitCode);
      }, 15);
      return;
    }
    process.exit(exitCode);
  }, 15);
} else if (mode === "wait") {
  fs.writeFileSync(process.env.STN_FAKE_READY, "ready");
  const release = process.env.STN_FAKE_RELEASE;
  const timer = setInterval(() => {
    if (fs.existsSync(release)) {
      clearInterval(timer);
      process.exit(0);
    }
  }, 15);
} else if (mode === "signal") {
  process.on("SIGINT", () => {
    fs.writeFileSync(process.env.STN_FAKE_GAME_SIGNAL, "SIGINT");
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    fs.writeFileSync(process.env.STN_FAKE_GAME_SIGNAL, "SIGTERM");
    process.exit(0);
  });
  fs.writeFileSync(process.env.STN_FAKE_READY, "ready");
  setInterval(() => {}, 1000);
} else {
  process.exit(exitCode);
}
`,
	);

	writeExecutable(
		helperPath,
		`
const fs = require("node:fs");
const { spawn } = require("node:child_process");
fs.writeFileSync(process.env.STN_FAKE_HELPER_PID, String(process.pid));
const st = fs.fstatSync(0);
const stdin = {
  dev: String(st.dev),
  ino: String(st.ino),
  matchesParentStdin:
    String(st.dev) === process.env.STN_EXPECT_STDIN_DEV &&
    String(st.ino) === process.env.STN_EXPECT_STDIN_INO,
};
fs.writeFileSync(process.env.STN_FAKE_REPORT, JSON.stringify({
  argv: process.argv.slice(2),
  ldPreload: Object.prototype.hasOwnProperty.call(process.env, "LD_PRELOAD")
    ? process.env.LD_PRELOAD
    : null,
  stdin,
}));
if (!stdin.matchesParentStdin) {
  process.stderr.write("stdin was a new pipe, not the wrapper fd 0\\n");
  process.exit(2);
}
let child;
function note(signal) {
  const file = process.env.STN_FAKE_SIGNAL;
  if (file) fs.writeFileSync(file, signal);
}
process.on("SIGINT", () => {
  note("SIGINT");
  if (child) child.kill("SIGINT");
});
process.on("SIGTERM", () => {
  note("SIGTERM");
  if (child) child.kill("SIGTERM");
});
child = spawn(process.argv[2], process.argv.slice(3), { stdio: "inherit" });
if (child.pid) fs.writeFileSync(process.env.STN_FAKE_GAME_PID, String(child.pid));
child.on("error", () => process.exit(1));
child.on("close", (code) => process.exit(code === null ? 1 : code));
`,
	);

	const previousEnv = new Map<string, string | undefined>();
	const assignEnv = (key: string, value: string | undefined) => {
		if (!previousEnv.has(key)) previousEnv.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	};
	assignEnv("STN_PTY_BIN", helperPath);
	assignEnv("STN_FAKE_MODE", options.mode);
	assignEnv("STN_FAKE_EXIT", String(options.exitCode ?? 0));
	assignEnv("STN_FAKE_REPORT", reportPath);
	assignEnv("STN_FAKE_PAYLOAD", payloadPath);
	assignEnv("STN_FAKE_READY", readyPath);
	assignEnv("STN_FAKE_RELEASE", releasePath);
	assignEnv("STN_FAKE_SIGNAL", signalPath);
	assignEnv("STN_FAKE_GAME_SIGNAL", gameSignalPath);
	assignEnv("STN_FAKE_HELPER_PID", helperPidPath);
	assignEnv("STN_FAKE_GAME_PID", gamePidPath);
	assignEnv("STN_FAKE_CUT", String(options.cut ?? 0));
	assignEnv("STN_FAKE_EXIT_FILE", exitPath);
	assignEnv("STN_EXPECT_STDIN_DEV", stdin.dev);
	assignEnv("STN_EXPECT_STDIN_INO", stdin.ino);
	assignEnv("LD_PRELOAD", options.ldPreload);

	const piped = tapStdioPipes(options.acceptStdout);
	const logLines: unknown[][] = [];
	const originalConsoleLog = console.log;
	console.log = (...args: unknown[]) => {
		logLines.push(args);
	};
	const restoreSignals = (() => {
		const before = new Set(process.listeners("SIGTERM"));
		return () => {
			for (const listener of process.listeners("SIGTERM")) {
				if (!before.has(listener)) process.removeListener("SIGTERM", listener);
			}
		};
	})();
	const lifecycle = spyChildLifecycle();
	const originalUnlink = fs.unlinkSync;
	let snapshot: Buffer | null = null;
	if (logFile) {
		const watched = path.resolve(logFile);
		fs.unlinkSync = ((target: fs.PathLike) => {
			const resolved = path.resolve(String(target));
			if (resolved === watched && fs.existsSync(resolved)) {
				snapshot = fs.readFileSync(resolved);
			}
			return originalUnlink(target);
		}) as typeof fs.unlinkSync;
	}

	let settled = false;
	const result = handler({
		args: {
			binPath,
			logFile,
			"--": options.args ?? [],
			_: [],
		},
		argv: [],
		logger: undefined as never,
		prompter: undefined as never,
	}).then(
		(value) => {
			settled = true;
			return value;
		},
		(error: unknown) => {
			settled = true;
			throw error;
		},
	);

	let cleaned = false;
	const cleanup = async () => {
		if (cleaned) return;
		cleaned = true;
		lifecycle.restore();
		fs.unlinkSync = originalUnlink;
		piped.releaseRefusedStdout();
		piped.restore();
		console.log = originalConsoleLog;
		restoreSignals();
		for (const [key, value] of previousEnv) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		killPidFile(gamePidPath);
		killPidFile(helperPidPath);
		await result.catch(() => undefined);
		fs.rmSync(dir, { recursive: true, force: true });
	};

	return {
		dir,
		gamePath,
		logFile,
		result,
		settled: () => settled,
		stdout: () => piped.stdout(),
		stderr: () => piped.stderr(),
		refusedStdout: () => piped.refusedStdout(),
		releaseRefusedStdout: () => piped.releaseRefusedStdout(),
		logSnapshot: () => snapshot,
		logs: () => logLines,
		readReport: () => JSON.parse(fs.readFileSync(reportPath, "utf8")) as Report,
		releaseWait: () => {
			fs.writeFileSync(releasePath, "go");
		},
		releaseExit: () => {
			fs.writeFileSync(exitPath, "go");
		},
		childEvents: lifecycle.events,
		signalPath,
		gameSignalPath,
		readyPath,
		cleanup,
	};
}

describe("stationeers run handler", { concurrency: false }, () => {
	test("game args have -noclear and never include a log flag", async () => {
		const run = startRun({
			args: ["-world", "Moon"],
			useLogFile: true,
			mode: "exit",
		});
		try {
			await run.result;
			const report = run.readReport();
			assert.deepEqual(report.argv, [run.gamePath, "-world", "Moon", "-noclear"]);
			assert.equal(
				report.argv.some((arg) => arg.toLowerCase() === "-logfile"),
				false,
			);
			assert.deepEqual(run.logSnapshot(), Buffer.alloc(0));
			assert.equal(fs.existsSync(run.logFile ?? ""), false);
			assert.deepEqual(run.logs(), [["Server process exited with code: ", 0]]);
		} finally {
			await run.cleanup();
		}
	});

	test("does not add a second -noclear when the user already passed one", async () => {
		const run = startRun({
			args: ["-batchmode", "-noclear", "-nographics"],
			mode: "exit",
		});
		try {
			await run.result;
			assert.deepEqual(run.readReport().argv, [
				run.gamePath,
				"-batchmode",
				"-noclear",
				"-nographics",
			]);
		} finally {
			await run.cleanup();
		}
	});

	test("helper fd 0 is the wrapper stdin, not a Node pipe", async () => {
		const expected = parentStdinIdentity();
		const run = startRun({ mode: "exit" });
		try {
			const outcome = await run.result.then(
				() => ({ ok: true as const }),
				(error: unknown) => ({ ok: false as const, error }),
			);
			const stdin = run.readReport().stdin;
			assert.equal(stdin.dev, expected.dev);
			assert.equal(stdin.ino, expected.ino);
			assert.equal(
				stdin.matchesParentStdin,
				true,
				"fake helper saw a stdin pipe created by Node instead of the inherited fd 0",
			);
			assert.equal(outcome.ok, true);
		} finally {
			await run.cleanup();
		}
	});

	for (const flag of ["-logfile", "-logFile", "-LOGFILE"]) {
		test(`rejects manual ${flag} and does not start the helper`, async () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stn-s5-"));
			const helperPath = path.join(dir, "stn-pty");
			const reportPath = path.join(dir, "report.json");
			const logFile = path.join(dir, "stationeers.log");
			writeExecutable(
				helperPath,
				`require("node:fs").writeFileSync(process.env.STN_FAKE_REPORT, "started");\n`,
			);
			const previousPty = process.env.STN_PTY_BIN;
			const previousReport = process.env.STN_FAKE_REPORT;
			process.env.STN_PTY_BIN = helperPath;
			process.env.STN_FAKE_REPORT = reportPath;
			try {
				await assert.rejects(
					() =>
						handler({
							args: {
								binPath: path.join(dir, "game"),
								logFile: flag === "-logFile" ? logFile : undefined,
								"--": [flag, flag === "-logFile" ? "-" : "x"],
								_: [],
							},
							argv: [],
							logger: undefined as never,
							prompter: undefined as never,
						}),
					(error: unknown) => {
						assert.ok(error instanceof Error);
						assert.match(error.message, /--log-file/);
						assert.match(error.message, /GAME_LOG_FILE/);
						return true;
					},
				);
				assert.equal(fs.existsSync(reportPath), false);
				assert.equal(fs.existsSync(logFile), false);
			} finally {
				if (previousPty === undefined) delete process.env.STN_PTY_BIN;
				else process.env.STN_PTY_BIN = previousPty;
				if (previousReport === undefined) delete process.env.STN_FAKE_REPORT;
				else process.env.STN_FAKE_REPORT = previousReport;
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});
	}

	test("tees identical helper stdout bytes and deletes the log file only after close", async () => {
		const run = startRun({
			useLogFile: true,
			mode: "output-wait",
			payload: PAYLOAD,
		});
		try {
			const logFile = run.logFile;
			assert.ok(logFile);
			await waitFor(() => {
				try {
					return (
						fs.readFileSync(logFile).equals(PAYLOAD) &&
						run.stdout().equals(PAYLOAD) &&
						run.stderr().equals(DIAGNOSTIC)
					);
				} catch {
					return false;
				}
			}, "log file and stdio to contain the helper output");
			assert.equal(
				run.settled(),
				false,
				"run promise settled before the helper finished flushing",
			);
			assert.equal(fs.existsSync(logFile), true);
			assert.deepEqual(fs.readFileSync(logFile), PAYLOAD);
			assert.deepEqual(run.stdout(), PAYLOAD);
			assert.deepEqual(run.stderr(), DIAGNOSTIC);
			assert.deepEqual(run.childEvents, ["close"]);

			run.releaseWait();
			await run.result;

			assert.equal(run.settled(), true);
			assert.deepEqual(run.logSnapshot(), PAYLOAD);
			assert.equal(fs.existsSync(logFile), false);
			assert.deepEqual(run.stdout(), PAYLOAD);
			assert.deepEqual(run.logs(), [["Server process exited with code: ", 0]]);
		} finally {
			await run.cleanup();
		}
	});

	test("does not append a stdout chunk the sink has not accepted", async () => {
		const accepted = Buffer.from("ACCEPTED-CHUNK\r\n", "utf8");
		const refused = Buffer.from("\x1b[48;1H> REFUSED-CHUNK", "utf8");
		const payload = Buffer.concat([accepted, refused]);
		const run = startRun({
			useLogFile: true,
			mode: "output-split",
			payload,
			cut: accepted.length,
			acceptStdout: (_chunk, index) => index === 0,
		});
		try {
			const logFile = run.logFile;
			assert.ok(logFile);
			await waitFor(() => {
				try {
					return fs.readFileSync(logFile).equals(accepted) && run.stdout().equals(accepted);
				} catch {
					return false;
				}
			}, "the accepted chunk to reach stdout and the log file");
			run.releaseWait();
			await waitFor(
				() => run.refusedStdout() >= 1 && fs.readFileSync(run.readyPath, "utf8") === "second",
				"the stdout sink to refuse the second chunk",
			);
			const logged = fs.readFileSync(logFile);
			assert.equal(
				logged.includes(refused),
				false,
				"log file contains a chunk the stdout sink never accepted",
			);
			assert.deepEqual(logged, accepted);
			assert.deepEqual(run.stdout(), accepted);
			assert.equal(logged.includes(DIAGNOSTIC), false);
			assert.deepEqual(run.stderr(), DIAGNOSTIC);
			run.releaseRefusedStdout();
			run.releaseExit();
			await run.result;
			assert.deepEqual(run.logs(), [["Server process exited with code: ", 0]]);
		} finally {
			await run.cleanup();
		}
	});

	test("stdout and stderr still receive helper output when --log-file is unset", async () => {
		const run = startRun({ mode: "output", payload: PAYLOAD });
		try {
			await run.result;
			assert.equal(run.logFile, undefined);
			assert.deepEqual(run.stdout(), PAYLOAD);
			assert.deepEqual(run.stderr(), DIAGNOSTIC);
		} finally {
			await run.cleanup();
		}
	});

	test("sets LD_PRELOAD on the child only", async () => {
		const run = startRun({ mode: "wait" });
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			assert.equal(process.env.LD_PRELOAD, undefined);
			assert.equal(run.readReport().ldPreload, SHIM_LIBRARY);
			run.releaseWait();
			await run.result;
			assert.equal(process.env.LD_PRELOAD, undefined);
		} finally {
			await run.cleanup();
		}
	});

	test("joins LD_PRELOAD with the parent value and does not change the parent", async () => {
		const run = startRun({
			mode: "wait",
			ldPreload: "libother.so:/opt/libtwo.so",
		});
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			assert.equal(process.env.LD_PRELOAD, "libother.so:/opt/libtwo.so");
			assert.equal(
				run.readReport().ldPreload,
				`${SHIM_LIBRARY}:libother.so:/opt/libtwo.so`,
			);
			run.releaseWait();
			await run.result;
			assert.equal(process.env.LD_PRELOAD, "libother.so:/opt/libtwo.so");
		} finally {
			await run.cleanup();
		}
	});

	test("does not duplicate the shim when LD_PRELOAD already lists it", async () => {
		const existing = `${SHIM_LIBRARY}:libother.so`;
		const run = startRun({ mode: "wait", ldPreload: existing });
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			assert.equal(run.readReport().ldPreload, existing);
			assert.equal(process.env.LD_PRELOAD, existing);
			run.releaseWait();
			await run.result;
		} finally {
			await run.cleanup();
		}
	});

	test("creates the log file before the helper exits and deletes it afterwards", async () => {
		const run = startRun({ useLogFile: true, mode: "wait" });
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			const logFile = run.logFile;
			assert.ok(logFile);
			assert.equal(fs.existsSync(logFile), true);
			assert.equal(fs.statSync(logFile).size, 0);
			assert.equal(run.settled(), false);
			run.releaseWait();
			await run.result;
			assert.deepEqual(run.logSnapshot(), Buffer.alloc(0));
			assert.equal(fs.existsSync(logFile), false);
		} finally {
			await run.cleanup();
		}
	});

	test("maps SIGTERM to SIGINT on the helper", async () => {
		const run = startRun({ mode: "signal" });
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			process.kill(process.pid, "SIGTERM");
			await run.result;
			assert.equal(fs.readFileSync(run.signalPath, "utf8"), "SIGINT");
			assert.equal(fs.readFileSync(run.gameSignalPath, "utf8"), "SIGINT");
			assert.deepEqual(run.logs(), [["Server process exited with code: ", 0]]);
		} finally {
			await run.cleanup();
		}
	});

	test("rejects a non-zero helper exit after flushing the log file", async () => {
		const run = startRun({
			useLogFile: true,
			mode: "output",
			exitCode: 7,
			payload: PAYLOAD,
		});
		try {
			await assert.rejects(run.result, (error: unknown) => {
				assert.ok(error instanceof Error);
				assert.equal(error.message, "Game tool exited with code 7");
				return true;
			});
			assert.deepEqual(run.logs(), [["Server process exited with code: ", 7]]);
			assert.deepEqual(run.logSnapshot(), PAYLOAD);
			assert.equal(fs.existsSync(run.logFile ?? ""), false);
			assert.deepEqual(run.stdout(), PAYLOAD);
			assert.deepEqual(run.stderr(), DIAGNOSTIC);
		} finally {
			await run.cleanup();
		}
	});
});
