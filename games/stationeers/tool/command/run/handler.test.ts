import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { describe, test } from "node:test";
import { RCON_DEFAULT_PORT } from "./command";
import handler from "./handler";
import {
	decodePackets,
	encodePacket,
	SERVERDATA_AUTH,
	SERVERDATA_EXECCOMMAND,
	SERVERDATA_RESPONSE_VALUE,
} from "./rcon/protocol";

// C2 rule: identical bytes. Helper stdout is written to process.stdout and, when
// --log-file is set, appended to that file with no CR or escape-sequence stripping.

const SHIM_LIBRARY = "/home/steam/shim/libkernel32-shim.so";

const PAYLOAD = Buffer.concat([
	Buffer.from("Ready\r\n", "utf8"),
	Buffer.from("\x1b[0m", "utf8"),
	Buffer.from("still-here\r\nTAIL\n", "utf8"),
]);
const DIAGNOSTIC = Buffer.from("pty-stderr");
const RCON_TEST_SECRET = "handler-rcon-test-secret";

function writeSettingXml(binPath: string, secret: string): void {
	fs.writeFileSync(
		path.join(binPath, "setting.xml"),
		`<?xml version="1.0" encoding="utf-8"?><SettingData><ServerAuthSecret>${secret}</ServerAuthSecret></SettingData>`,
	);
}

async function collectRconIdle(socket: net.Socket, idleMs = 400): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let idleTimer: ReturnType<typeof setTimeout> | undefined;
		const hardTimer = setTimeout(() => {
			cleanup();
			socket.destroy();
			reject(new Error("timed out collecting RCON packets"));
		}, 8000);
		const onData = (chunk: Buffer): void => {
			chunks.push(chunk);
			bumpIdle();
		};
		const onError = (err: Error): void => {
			cleanup();
			reject(err);
		};
		const cleanup = (): void => {
			clearTimeout(hardTimer);
			if (idleTimer !== undefined) clearTimeout(idleTimer);
			socket.off("data", onData);
			socket.off("error", onError);
		};
		const finish = (): void => {
			cleanup();
			resolve(Buffer.concat(chunks));
		};
		const bumpIdle = (): void => {
			if (idleTimer !== undefined) clearTimeout(idleTimer);
			if (chunks.length === 0) return;
			idleTimer = setTimeout(finish, idleMs);
		};
		socket.on("data", onData);
		socket.on("error", onError);
	});
}

async function rconExec(
	port: number,
	secret: string,
	command: string,
): Promise<string> {
	const socket = await tcpConnect(port);
	try {
		socket.write(encodePacket(11, SERVERDATA_AUTH, secret));
		await collectRconIdle(socket);
		socket.write(encodePacket(22, SERVERDATA_EXECCOMMAND, command));
		const execBytes = await collectRconIdle(socket, 900);
		const { packets } = decodePackets(execBytes);
		const responses = packets.filter((p) => p.type === SERVERDATA_RESPONSE_VALUE);
		return responses.map((p) => p.body).join("");
	} finally {
		socket.destroy();
	}
}

type Report = {
	argv: string[];
	ldPreload: string | null;
	stdin: { dev: string; ino: string; isPipe: boolean; matchesParentStdin: boolean };
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
	stdinPath: string;
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

function swapStdin(stream: Readable): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(process, "stdin");
	Object.defineProperty(process, "stdin", {
		configurable: true,
		enumerable: true,
		get: () => stream,
	});
	return () => {
		if (descriptor) Object.defineProperty(process, "stdin", descriptor);
	};
}

function tcpConnect(port: number, host = "127.0.0.1"): Promise<net.Socket> {
	return new Promise((resolve, reject) => {
		const socket = net.connect({ port, host }, () => resolve(socket));
		socket.once("error", reject);
	});
}

function captureListenHost(): { hosts: string[]; restore: () => void } {
	const hosts: string[] = [];
	const original = net.Server.prototype.listen;
	net.Server.prototype.listen = function (
		this: net.Server,
		...args: unknown[]
	): net.Server {
		if (typeof args[1] === "string") {
			hosts.push(args[1]);
		}
		return original.apply(this, args as Parameters<typeof original>);
	} as typeof net.Server.prototype.listen;
	return {
		hosts,
		restore() {
			net.Server.prototype.listen = original;
		},
	};
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
	rcon?: string;
	useLogFile?: boolean;
	mode:
		| "exit"
		| "output"
		| "output-wait"
		| "output-split"
		| "wait"
		| "signal"
		| "stdin"
		| "rcon-console";
	exitCode?: number;
	payload?: Buffer;
	cut?: number;
	ldPreload?: string;
	rconSecret?: string;
	rconReplyGate?: string;
	acceptStdout?: (chunk: Buffer, index: number) => boolean;
}): Started {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stn-s5-"));
	const binPath = path.join(dir, "game");
	fs.mkdirSync(binPath);
	if (options.rconSecret) {
		writeSettingXml(binPath, options.rconSecret);
	}
	const gamePath = path.join(binPath, "rocketstation_DedicatedServer.x86_64");
	const helperPath = path.join(dir, "stn-pty");
	const reportPath = path.join(dir, "report.json");
	const payloadPath = path.join(dir, "payload.bin");
	const readyPath = path.join(dir, "ready");
	const releasePath = path.join(dir, "release");
	const signalPath = path.join(dir, "helper-signal");
	const gameSignalPath = path.join(dir, "game-signal");
	const stdinPath = path.join(dir, "game-stdin");
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
} else if (mode === "rcon-console") {
  let seen = Buffer.alloc(0);
  let helpReplyStarted = false;
  function maybeReplyHelp() {
    if (helpReplyStarted) return;
    if (!seen.includes(Buffer.from("help\\n"))) return;
    helpReplyStarted = true;
    const go = () => {
      process.stdout.write("help\\r\\n");
      process.stdout.write("\\x1b[5;1H> ");
      process.stdout.write("\\x1b[2K");
      process.stdout.write("\\x1b[5;1H");
      process.stdout.write("Tags: [launch]\\r\\n");
      process.stdout.write("\\x1b[6;1H> ");
    };
    const gate = process.env.STN_FAKE_RCON_REPLY;
    if (gate && !fs.existsSync(gate)) {
      const timer = setInterval(() => {
        if (fs.existsSync(gate)) {
          clearInterval(timer);
          go();
        }
      }, 15);
    } else {
      go();
    }
  }
  process.stdin.on("data", (chunk) => {
    seen = Buffer.concat([seen, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    fs.writeFileSync(process.env.STN_FAKE_STDIN, seen);
    maybeReplyHelp();
    if (seen.includes(Buffer.from("quit\\n"))) process.exit(0);
  });
  fs.writeFileSync(process.env.STN_FAKE_READY, "ready");
  setInterval(() => {}, 1000);
} else if (mode === "signal" || mode === "stdin") {
  process.on("SIGINT", () => {
    fs.writeFileSync(process.env.STN_FAKE_GAME_SIGNAL, "SIGINT");
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    fs.writeFileSync(process.env.STN_FAKE_GAME_SIGNAL, "SIGTERM");
    process.exit(0);
  });
  let seen = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    seen = Buffer.concat([seen, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    fs.writeFileSync(process.env.STN_FAKE_STDIN, seen);
    if (seen.includes(10)) process.exit(0);
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
  isPipe: st.isFIFO() || st.isSocket(),
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
	assignEnv("STN_FAKE_STDIN", stdinPath);
	assignEnv("STN_FAKE_HELPER_PID", helperPidPath);
	assignEnv("STN_FAKE_GAME_PID", gamePidPath);
	assignEnv("STN_FAKE_CUT", String(options.cut ?? 0));
	assignEnv("STN_FAKE_EXIT_FILE", exitPath);
	assignEnv("STN_EXPECT_STDIN_DEV", stdin.dev);
	assignEnv("STN_EXPECT_STDIN_INO", stdin.ino);
	assignEnv("STN_FAKE_RCON_REPLY", options.rconReplyGate);
	assignEnv("LD_PRELOAD", options.ldPreload);

	const piped = tapStdioPipes(options.acceptStdout);
	const logLines: unknown[][] = [];
	const originalConsoleLog = console.log;
	console.log = (...args: unknown[]) => {
		logLines.push(args);
	};
	const restoreSignals = (() => {
		const signals = ["SIGTERM", "SIGINT"] as const;
		const before = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
		return () => {
			for (const signal of signals) {
				const keep = before.get(signal);
				for (const listener of process.listeners(signal)) {
					if (!keep?.has(listener)) process.removeListener(signal, listener);
				}
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
			rcon: options.rcon,
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
		stdinPath,
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

	test("helper stdin is a pipe the wrapper can write", async () => {
		const run = startRun({ mode: "exit" });
		try {
			await run.result;
			const stdin = run.readReport().stdin;
			assert.equal(stdin.isPipe, true);
			assert.equal(stdin.matchesParentStdin, false);
		} finally {
			await run.cleanup();
		}
	});

	test("copies wrapper stdin through to the game console", async () => {
		const input = new PassThrough();
		const restoreStdin = swapStdin(input);
		const run = startRun({ mode: "stdin" });
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			input.write("save demo\n");
			await run.result;
			assert.equal(fs.readFileSync(run.stdinPath, "utf8"), "save demo\n");
			assert.equal(fs.existsSync(run.signalPath), false);
			assert.equal(fs.existsSync(run.gameSignalPath), false);
		} finally {
			restoreStdin();
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

	test("writes quit on SIGTERM and does not signal the helper or the game", async () => {
		const run = startRun({ mode: "signal" });
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			process.kill(process.pid, "SIGTERM");
			await run.result;
			assert.equal(fs.readFileSync(run.stdinPath, "utf8"), "quit\n");
			assert.equal(fs.existsSync(run.signalPath), false);
			assert.equal(fs.existsSync(run.gameSignalPath), false);
			assert.deepEqual(run.logs(), [["Server process exited with code: ", 0]]);
		} finally {
			await run.cleanup();
		}
	});

	test("writes quit on SIGINT and does not signal the helper or the game", async () => {
		const runnerInt = process.listeners("SIGINT").slice();
		const run = startRun({ mode: "signal" });
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			for (const listener of runnerInt) process.removeListener("SIGINT", listener);
			process.kill(process.pid, "SIGINT");
			await run.result;
			assert.equal(fs.readFileSync(run.stdinPath, "utf8"), "quit\n");
			assert.equal(fs.existsSync(run.signalPath), false);
			assert.equal(fs.existsSync(run.gameSignalPath), false);
			assert.deepEqual(run.logs(), [["Server process exited with code: ", 0]]);
		} finally {
			await run.cleanup();
			for (const listener of runnerInt) {
				if (!process.listeners("SIGINT").includes(listener)) process.on("SIGINT", listener);
			}
		}
	});

	test("A1 — without --rcon nothing listens on the default RCON port", async () => {
		const run = startRun({ mode: "wait" });
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			await assert.rejects(
				() => tcpConnect(RCON_DEFAULT_PORT),
				(err: unknown) => {
					assert.ok(err instanceof Error);
					assert.match(err.message, /ECONNREFUSED/);
					return true;
				},
			);
			run.releaseWait();
			await run.result;
		} finally {
			await run.cleanup();
		}
	});

	test("A2 — bare --rcon listens on 0.0.0.0 and the default port", async () => {
		const listen = captureListenHost();
		const run = startRun({ mode: "wait", rcon: "" });
		let socket: net.Socket | undefined;
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			assert.deepEqual(listen.hosts, ["0.0.0.0"]);
			socket = await tcpConnect(RCON_DEFAULT_PORT);
			socket.destroy();
			socket = undefined;
			run.releaseWait();
			await run.result;
		} finally {
			socket?.destroy();
			listen.restore();
			await run.cleanup();
		}
	});

	test("A4 — --rcon=27015 listens on 27015 and not on 27500", async () => {
		const run = startRun({ mode: "wait", rcon: "27015" });
		let socket: net.Socket | undefined;
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			socket = await tcpConnect(27015);
			socket.destroy();
			socket = undefined;
			await assert.rejects(
				() => tcpConnect(RCON_DEFAULT_PORT),
				(err: unknown) => {
					assert.ok(err instanceof Error);
					assert.match(err.message, /ECONNREFUSED/);
					return true;
				},
			);
			run.releaseWait();
			await run.result;
		} finally {
			socket?.destroy();
			await run.cleanup();
		}
	});

	test("A5 — invalid --rcon values do not start the helper or bind RCON", async () => {
		for (const port of ["0", "99999", "abc", "01"]) {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stn-rcon-a5-"));
			const helperPath = path.join(dir, "stn-pty");
			const reportPath = path.join(dir, "report.json");
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
								rcon: port,
								"--": [],
								_: [],
							},
							argv: [],
							logger: undefined as never,
							prompter: undefined as never,
						}),
					(error: unknown) => {
						assert.ok(error instanceof Error);
						return true;
					},
				);
				assert.equal(fs.existsSync(reportPath), false);
				await assert.rejects(
					() => tcpConnect(RCON_DEFAULT_PORT),
					(err: unknown) => {
						assert.ok(err instanceof Error);
						assert.match(err.message, /ECONNREFUSED/);
						return true;
					},
				);
			} finally {
				if (previousPty === undefined) delete process.env.STN_PTY_BIN;
				else process.env.STN_PTY_BIN = previousPty;
				if (previousReport === undefined) delete process.env.STN_FAKE_REPORT;
				else process.env.STN_FAKE_REPORT = previousReport;
				fs.rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	test("A7 — RCON bind failure does not start the helper", async () => {
		const blocker = await new Promise<net.Server>((resolve, reject) => {
			const server = net.createServer();
			server.once("error", reject);
			server.listen(RCON_DEFAULT_PORT, "0.0.0.0", () => resolve(server));
		});
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stn-rcon-a7-"));
		const helperPath = path.join(dir, "stn-pty");
		const reportPath = path.join(dir, "report.json");
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
							rcon: "",
							"--": [],
							_: [],
						},
						argv: [],
						logger: undefined as never,
						prompter: undefined as never,
					}),
				(error: unknown) => {
					assert.ok(error instanceof Error);
					assert.match(error.message, /Failed to bind RCON/);
					return true;
				},
			);
			assert.equal(fs.existsSync(reportPath), false);
		} finally {
			await new Promise<void>((resolve, reject) => {
				blocker.close((err) => (err ? reject(err) : resolve()));
			});
			if (previousPty === undefined) delete process.env.STN_PTY_BIN;
			else process.env.STN_PTY_BIN = previousPty;
			if (previousReport === undefined) delete process.env.STN_FAKE_REPORT;
			else process.env.STN_FAKE_REPORT = previousReport;
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("C6 — partial stdin and RCON help stay on separate lines", async () => {
		const input = new PassThrough();
		const restoreStdin = swapStdin(input);
		const run = startRun({
			mode: "rcon-console",
			rcon: "",
			rconSecret: RCON_TEST_SECRET,
		});
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			const socket = await tcpConnect(RCON_DEFAULT_PORT);
			try {
				socket.write(encodePacket(11, SERVERDATA_AUTH, RCON_TEST_SECRET));
				await collectRconIdle(socket);
				input.write("save");
				await waitFor(() => {
					try {
						const text = fs.readFileSync(run.stdinPath, "utf8");
						return text.includes("save") && !text.includes("help");
					} catch {
						return false;
					}
				}, "partial stdin without RCON line");
				socket.write(encodePacket(22, SERVERDATA_EXECCOMMAND, "help"));
				const execBytesPromise = collectRconIdle(socket, 1200);
				input.write("\n");
				await waitFor(() => {
					try {
						const text = fs.readFileSync(run.stdinPath, "utf8");
						return text.includes("save\n") && text.includes("help\n");
					} catch {
						return false;
					}
				}, "save line then RCON help on console stdin");
				const execBytes = await execBytesPromise;
				const { packets } = decodePackets(execBytes);
				const body = packets
					.filter((p) => p.type === SERVERDATA_RESPONSE_VALUE)
					.map((p) => p.body)
					.join("");
				assert.equal(body, "Tags: [launch]");
				const stdinBytes = fs.readFileSync(run.stdinPath, "utf8");
				assert.equal(stdinBytes.includes("save\n"), true);
				assert.equal(stdinBytes.includes("help\n"), true);
				assert.equal(stdinBytes.includes("savehelp"), false);
				assert.match(stdinBytes, /save\n[\s\S]*help\n/);
			} finally {
				socket.destroy();
			}
			input.write("quit\n");
			await run.result;
		} finally {
			restoreStdin();
			await run.cleanup();
		}
	});

	test("D6 — SIGINT during in-flight RCON writes help then quit on separate lines", async () => {
		const replyGate = path.join(os.tmpdir(), `stn-r9-d6-${process.pid}-${Date.now()}`);
		const runnerInt = process.listeners("SIGINT").slice();
		const run = startRun({
			mode: "rcon-console",
			rcon: "",
			rconSecret: RCON_TEST_SECRET,
			rconReplyGate: replyGate,
		});
		try {
			await waitFor(() => fs.existsSync(run.readyPath), "helper readiness");
			const execPromise = rconExec(RCON_DEFAULT_PORT, RCON_TEST_SECRET, "help");
			await waitFor(() => {
				try {
					return fs.readFileSync(run.stdinPath, "utf8").includes("help\n");
				} catch {
					return false;
				}
			}, "RCON help line on console stdin");
			for (const listener of runnerInt) process.removeListener("SIGINT", listener);
			process.kill(process.pid, "SIGINT");
			fs.writeFileSync(replyGate, "go");
			await execPromise;
			await run.result;
			const stdinBytes = fs.readFileSync(run.stdinPath, "utf8");
			const helpAt = stdinBytes.indexOf("help\n");
			const quitAt = stdinBytes.indexOf("quit\n");
			assert.ok(helpAt >= 0);
			assert.ok(quitAt > helpAt);
			assert.equal(stdinBytes.includes("helpquit"), false);
			assert.equal(fs.existsSync(run.signalPath), false);
			assert.equal(fs.existsSync(run.gameSignalPath), false);
		} finally {
			for (const listener of runnerInt) {
				if (!process.listeners("SIGINT").includes(listener)) process.on("SIGINT", listener);
			}
			try {
				fs.unlinkSync(replyGate);
			} catch {
				// already removed
			}
			await run.cleanup();
		}
	});

	test("C5 — with --rcon enabled helper stdout bytes are unchanged on container stdout", async () => {
		const run = startRun({
			mode: "output",
			payload: PAYLOAD,
			rcon: "",
		});
		try {
			await run.result;
			assert.deepEqual(run.stdout(), PAYLOAD);
			assert.deepEqual(run.stderr(), DIAGNOSTIC);
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
