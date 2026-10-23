import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
	PLAYER_LOG_MISSING_WARNING,
	PLAYER_LOG_WAIT_MS,
	startPlayerLog,
	type PlayerLogTail,
} from "./playerlog";

type Snap = { fds: number; timeouts: number; watches: number };

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
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

function fdCount(): number {
	return fs.readdirSync("/dev/fd").length;
}

function snapshot(): Snap {
	const info = process.getActiveResourcesInfo();
	return {
		fds: fdCount(),
		timeouts: info.filter((name) => name === "Timeout").length,
		watches: info.filter(
			(name) => name === "FSEventWrap" || name === "FSWatcher" || name === "StatWatcher",
		).length,
	};
}

// Timers and watch handles are stable across a test. Process fd counts are not:
// the runner closes its own descriptors while the test is running.
function assertNoHandleLeak(before: Snap): void {
	const after = snapshot();
	assert.equal(
		after.timeouts,
		before.timeouts,
		`timer leak (${process.getActiveResourcesInfo().join(",")})`,
	);
	assert.equal(after.watches, before.watches, "file watcher leaked");
}

function assertFileFdReleased(tail: PlayerLogTail): void {
	const before = fdCount();
	tail.stop();
	assert.equal(fdCount(), before - 1, "Player.log fd was not closed on stop");
}

function capture(): { write: (chunk: string | Uint8Array) => boolean; text: () => string } {
	const chunks: Buffer[] = [];
	return {
		write(chunk: string | Uint8Array): boolean {
			chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
			return true;
		},
		text(): string {
			return Buffer.concat(chunks).toString("utf8");
		},
	};
}

function writePlayerLog(
	home: string,
	contents: string,
	company = "Rocketwerkz",
	product = "rocketstation",
): string {
	const file = path.join(home, ".config", "unity3d", company, product, "Player.log");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, contents);
	return file;
}

describe("Unity Player.log tail", { concurrency: false }, () => {
	test("file appears late", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "stn-s6-"));
		const out = capture();
		const before = snapshot();
		let tail: PlayerLogTail | undefined;
		try {
			tail = startPlayerLog({
				homeDir: home,
				waitMs: 2_000,
				pollMs: 20,
				stderr: out,
				keepAlive: true,
			});
			await delay(50);
			assert.equal(out.text(), "");
			const file = writePlayerLog(home, "before attach\n");
			await waitFor(() => out.text() === "before attach\n", "late Player.log");
			fs.appendFileSync(file, "appended line\n");
			await waitFor(
				() => out.text() === "before attach\nappended line\n",
				"bytes appended after attach",
			);
			assertFileFdReleased(tail);
			assertNoHandleLeak(before);
		} finally {
			tail?.stop();
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	test("file pre-exists", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "stn-s6-"));
		const file = writePlayerLog(home, "already here\n");
		const out = capture();
		const before = snapshot();
		let tail: PlayerLogTail | undefined;
		try {
			tail = startPlayerLog({
				homeDir: home,
				waitMs: 2_000,
				pollMs: 20,
				stderr: out,
				keepAlive: true,
			});
			await waitFor(() => out.text() === "already here\n", "content written before attach");
			fs.appendFileSync(file, "more\n");
			await waitFor(() => out.text() === "already here\nmore\n", "append to an existing file");
			assert.equal(out.text().includes(PLAYER_LOG_MISSING_WARNING), false);
			assertFileFdReleased(tail);
			assertNoHandleLeak(before);
		} finally {
			tail?.stop();
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	test("never appears", async () => {
		assert.equal(PLAYER_LOG_WAIT_MS, 30_000);
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "stn-s6-"));
		const out = capture();
		const before = snapshot();
		const waitMs = 180;
		let tail: PlayerLogTail | undefined;
		try {
			const started = Date.now();
			tail = startPlayerLog({
				homeDir: home,
				waitMs,
				pollMs: 20,
				stderr: out,
				keepAlive: true,
			});
			await waitFor(() => out.text() === PLAYER_LOG_MISSING_WARNING, "missing-file warning");
			const elapsed = Date.now() - started;
			assert.ok(elapsed + 25 >= waitMs, `warned too early (${elapsed}ms)`);
			assert.ok(elapsed < waitMs + 1_500, `warned too late (${elapsed}ms)`);
			writePlayerLog(home, "too late\n");
			await delay(80);
			assert.equal(out.text(), PLAYER_LOG_MISSING_WARNING);
			assertNoHandleLeak(before);
			tail.stop();
			assertNoHandleLeak(before);
		} finally {
			tail?.stop();
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	test("stop on exit", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "stn-s6-"));
		const out = capture();
		const before = snapshot();
		let tail: PlayerLogTail | undefined;
		try {
			const started = Date.now();
			tail = startPlayerLog({
				homeDir: home,
				stderr: out,
				keepAlive: true,
			});
			const startedMs = Date.now() - started;
			tail.stop();
			const stoppedMs = Date.now() - started;
			assert.ok(startedMs < 100, "discovery waited inside startPlayerLog");
			assert.ok(stoppedMs < 100, "stop waited for the missing file");
			writePlayerLog(home, "after stop\n");
			await delay(80);
			assert.equal(out.text(), "");
			assertNoHandleLeak(before);

			const file = writePlayerLog(home, "live\n");
			tail = startPlayerLog({
				homeDir: home,
				waitMs: 2_000,
				pollMs: 20,
				stderr: out,
				keepAlive: true,
			});
			await waitFor(() => out.text() === "live\n", "attached Player.log");
			fs.appendFileSync(file, "still live\n");
			await waitFor(() => out.text() === "live\nstill live\n", "follow before exit");
			assertFileFdReleased(tail);
			fs.appendFileSync(file, "after exit\n");
			await delay(80);
			assert.equal(out.text(), "live\nstill live\n");
			assertNoHandleLeak(before);
		} finally {
			tail?.stop();
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	test("a missing file does not hold the event loop", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "stn-s6-"));
		const out = capture();
		const before = snapshot();
		let tail: PlayerLogTail | undefined;
		try {
			const started = Date.now();
			tail = startPlayerLog({ homeDir: home, stderr: out });
			assert.ok(Date.now() - started < 50, "start waited for Player.log");
			await delay(40);
			assert.equal(out.text(), "");
			assertNoHandleLeak(before);
			tail.stop();
			assert.ok(Date.now() - started < 200, "stop waited for Player.log");
			assert.equal(out.text(), "");
			assertNoHandleLeak(before);
		} finally {
			tail?.stop();
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	test("falls back to ~/.config/unity3d/*/*/Player.log", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "stn-s6-"));
		writePlayerLog(home, "fallback-line\n", "OtherCo", "othergame");
		const out = capture();
		const before = snapshot();
		let tail: PlayerLogTail | undefined;
		try {
			tail = startPlayerLog({
				homeDir: home,
				waitMs: 1_000,
				pollMs: 20,
				stderr: out,
				keepAlive: true,
			});
			await waitFor(() => out.text() === "fallback-line\n", "glob Player.log");
			assertFileFdReleased(tail);
			assertNoHandleLeak(before);
		} finally {
			tail?.stop();
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	test("prefers Rocketwerkz/rocketstation over another Player.log", async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "stn-s6-"));
		const known = writePlayerLog(home, "known-line\n");
		const other = writePlayerLog(home, "other-line\n", "OtherCo", "othergame");
		const now = new Date();
		fs.utimesSync(known, now, new Date(now.getTime() - 60_000));
		fs.utimesSync(other, now, now);
		const out = capture();
		const before = snapshot();
		let tail: PlayerLogTail | undefined;
		try {
			tail = startPlayerLog({
				homeDir: home,
				waitMs: 1_000,
				pollMs: 20,
				stderr: out,
				keepAlive: true,
			});
			await waitFor(() => out.text().includes("known-line\n"), "known Player.log");
			await delay(50);
			assert.equal(out.text(), "known-line\n");
			assertFileFdReleased(tail);
			assertNoHandleLeak(before);
		} finally {
			tail?.stop();
			fs.rmSync(home, { recursive: true, force: true });
		}
	});
});
