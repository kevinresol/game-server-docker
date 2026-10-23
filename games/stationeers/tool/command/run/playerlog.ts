import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// S1: on a PTY run there was no Player.log under /home/steam. If Unity creates
// one later, the company/product directory is Rocketwerkz/rocketstation.
// Otherwise accept ~/.config/unity3d/*/*/Player.log. A missing file warns once.

export const PLAYER_LOG_WAIT_MS = 30_000;

export const PLAYER_LOG_MISSING_WARNING =
	"Player.log was not found under ~/.config/unity3d; Unity's file log will not be mirrored\n";

const DEFAULT_POLL_MS = 200;
const READ_CHUNK = 64 * 1024;
const MAX_BYTES_PER_PASS = 256 * 1024;

const KNOWN_COMPANY = "Rocketwerkz";
const KNOWN_PRODUCT = "rocketstation";

export type PlayerLogTail = {
	stop: () => void;
};

export type PlayerLogOptions = {
	// Defaults to os.homedir(), which follows HOME for the steam user.
	homeDir?: string;
	// Defaults to about 30s. Tests pass a shorter bound.
	waitMs?: number;
	// How often to look for the file and for appended bytes.
	pollMs?: number;
	// Defaults to process.stderr. Unity's file log is never written to stdout.
	stderr?: { write: (chunk: string | Uint8Array) => unknown };
	// Tests set this so a leaked poll timer stays visible and holds the event
	// loop. Production leaves it unset so a missed stop cannot delay shutdown.
	keepAlive?: boolean;
};

export function startPlayerLog(options: PlayerLogOptions = {}): PlayerLogTail {
	let homeDir: string;
	try {
		homeDir = options.homeDir ?? os.homedir();
	} catch {
		return { stop() {} };
	}

	const waitMs =
		options.waitMs === undefined ? PLAYER_LOG_WAIT_MS : Math.max(0, options.waitMs);
	const pollMs = options.pollMs && options.pollMs > 0 ? options.pollMs : DEFAULT_POLL_MS;
	const stderr = options.stderr ?? process.stderr;
	const keepAlive = options.keepAlive === true;
	const deadline = Date.now() + waitMs;

	let stopped = false;
	let stopping = false;
	let warned = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let fd: number | undefined;
	let inode = 0;
	let position = 0;
	let attachedPath: string | undefined;
	let reading = false;

	function closeFd(): void {
		if (fd === undefined) return;
		const opened = fd;
		fd = undefined;
		try {
			fs.closeSync(opened);
		} catch {
			// already closed
		}
	}

	function disarm(): void {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		closeFd();
	}

	function schedule(delay: number, fn: () => void): void {
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			fn();
		}, delay);
		if (!keepAlive) timer.unref();
	}

	function isFile(file: string): boolean {
		try {
			return fs.statSync(file).isFile();
		} catch {
			return false;
		}
	}

	function isDir(dir: string): boolean {
		try {
			return fs.statSync(dir).isDirectory();
		} catch {
			return false;
		}
	}

	// Prefer the S1 path. Otherwise the newest two-level Player.log wins.
	function findPlayerLog(): string | null {
		const known = path.join(
			homeDir,
			".config",
			"unity3d",
			KNOWN_COMPANY,
			KNOWN_PRODUCT,
			"Player.log",
		);
		if (isFile(known)) return known;

		const root = path.join(homeDir, ".config", "unity3d");
		if (!isDir(root)) return null;

		let companies: string[];
		try {
			companies = fs.readdirSync(root);
		} catch {
			return null;
		}

		let best: { file: string; mtimeMs: number } | undefined;
		for (const company of companies) {
			const companyDir = path.join(root, company);
			if (!isDir(companyDir)) continue;
			let products: string[];
			try {
				products = fs.readdirSync(companyDir);
			} catch {
				continue;
			}
			for (const product of products) {
				const candidate = path.join(companyDir, product, "Player.log");
				let stat: fs.Stats;
				try {
					stat = fs.statSync(candidate);
				} catch {
					continue;
				}
				if (!stat.isFile()) continue;
				if (
					!best ||
					stat.mtimeMs > best.mtimeMs ||
					(stat.mtimeMs === best.mtimeMs && candidate < best.file)
				) {
					best = { file: candidate, mtimeMs: stat.mtimeMs };
				}
			}
		}
		return best?.file ?? null;
	}

	function openFile(file: string): boolean {
		let opened: number;
		try {
			opened = fs.openSync(file, "r");
		} catch {
			return false;
		}
		try {
			const stat = fs.fstatSync(opened);
			if (!stat.isFile()) {
				fs.closeSync(opened);
				return false;
			}
			closeFd();
			fd = opened;
			inode = stat.ino;
			position = 0;
			attachedPath = file;
			return true;
		} catch {
			try {
				fs.closeSync(opened);
			} catch {
				// ignore a double close
			}
			return false;
		}
	}

	// Copy from offset 0 on attach, then only bytes appended after that.
	function readNew(): void {
		if (reading || fd === undefined || attachedPath === undefined) return;
		reading = true;
		try {
			let pathStat: fs.Stats;
			try {
				pathStat = fs.statSync(attachedPath);
			} catch {
				return;
			}
			if (!pathStat.isFile()) return;
			if (pathStat.ino !== inode && !openFile(attachedPath)) return;

			let budget = MAX_BYTES_PER_PASS;
			while (budget > 0 && fd !== undefined && !stopped) {
				const current = fs.fstatSync(fd);
				if (current.size < position) position = 0;
				if (current.size <= position) return;
				const length = Math.min(READ_CHUNK, current.size - position, budget);
				const buf = Buffer.alloc(length);
				const bytes = fs.readSync(fd, buf, 0, length, position);
				if (bytes <= 0) return;
				stderr.write(buf.subarray(0, bytes));
				position += bytes;
				budget -= bytes;
			}
		} catch {
			// The file may be replaced between stat and read. The next poll retries.
		} finally {
			reading = false;
		}
	}

	function warnOnce(): void {
		if (warned || stopped) return;
		warned = true;
		stopped = true;
		disarm();
		try {
			stderr.write(PLAYER_LOG_MISSING_WARNING);
		} catch {
			// A broken stderr must not take down the server.
		}
	}

	function tick(): void {
		if (stopped) return;
		try {
			if (!attachedPath) {
				const found = findPlayerLog();
				if (found) openFile(found);
			}
			if (attachedPath) readNew();
		} catch {
			// Discovery failures are non-fatal.
		}
		if (stopped) return;
		const now = Date.now();
		if (!attachedPath && now >= deadline) {
			warnOnce();
			return;
		}
		const delay = attachedPath ? pollMs : Math.min(pollMs, Math.max(1, deadline - now));
		schedule(delay, tick);
	}

	function stop(): void {
		if (stopped || stopping) return;
		stopping = true;
		try {
			// One pass covers bytes appended since the last poll without reading
			// a large log synchronously on the shutdown path.
			readNew();
		} catch {
			// ignore
		}
		stopped = true;
		disarm();
		stopping = false;
	}

	try {
		schedule(0, tick);
	} catch {
		// Starting the tail must not fail the run.
	}

	return { stop };
}
