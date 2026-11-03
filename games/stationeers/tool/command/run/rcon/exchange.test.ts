import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, test } from "node:test";
import {
	CONSOLE_REPLY_TIMEOUT_MS,
	createConsoleExchange,
} from "./exchange";
import {
	type FramerClock,
	type FramerTimer,
	PROMPT_STABLE_MS,
} from "./framer";

type FakeClock = FramerClock & {
	advance(ms: number): void;
};

function createFakeClock(start = 0): FakeClock {
	let now = start;
	const timers: Array<{ at: number; fn: () => void; cleared: boolean }> = [];
	return {
		now: () => now,
		setTimeout(fn: () => void, ms: number): FramerTimer {
			const entry = { at: now + ms, fn, cleared: false };
			timers.push(entry);
			return {
				clear() {
					entry.cleared = true;
				},
			};
		},
		advance(ms: number) {
			now += ms;
			for (;;) {
				const due = timers
					.filter((entry) => !entry.cleared && entry.at <= now)
					.sort((a, b) => a.at - b.at);
				if (due.length === 0) break;
				const next = due[0];
				assert.ok(next);
				next.cleared = true;
				next.fn();
			}
		},
	};
}

function home(row: number): string {
	return `\x1b[${row};1H`;
}

function stablePrompt(row: number): string {
	return `${home(row)}> `;
}

describe("console exchange", () => {
	test("C7 — overlapping submits write in order after each reply ends", async () => {
		const clock = createFakeClock();
		const stdout = new PassThrough();
		const writes: string[] = [];
		const exchange = createConsoleExchange({
			stdout,
			clock,
			write(line) {
				writes.push(line);
			},
		});

		const first = exchange.submit("help");
		const second = exchange.submit("save");

		stdout.write("help\r\n");
		stdout.write(stablePrompt(1));
		clock.advance(PROMPT_STABLE_MS);
		const firstBody = await first;
		assert.equal(firstBody, "");
		assert.deepEqual(writes, ["help\n", "save\n"]);

		stdout.write("save\r\n");
		stdout.write("Saving\r\n");
		stdout.write(stablePrompt(2));
		clock.advance(PROMPT_STABLE_MS);
		const secondBody = await second;
		assert.equal(secondBody, "Saving");
		assert.deepEqual(writes, ["help\n", "save\n"]);
		stdout.end();
	});

	test("C9 — timeout blocks writes until a stable prompt, then excludes stale bytes", async () => {
		const clock = createFakeClock();
		const stdout = new PassThrough();
		const writes: string[] = [];
		const exchange = createConsoleExchange({
			stdout,
			clock,
			write(line) {
				writes.push(line);
			},
		});

		stdout.write("stale output\r\n");
		const timedOut = exchange.submit("hang");
		stdout.write("hang\r\n");
		stdout.write("partial from timed-out command\r\n");

		clock.advance(CONSOLE_REPLY_TIMEOUT_MS);
		assert.equal(await timedOut, "console reply timed out");
		assert.deepEqual(writes, ["hang\n"]);

		const rejected = exchange.submit("next");
		assert.equal(await rejected, "console reply timed out");
		assert.deepEqual(writes, ["hang\n"]);

		stdout.write(stablePrompt(3));
		clock.advance(PROMPT_STABLE_MS);
		await Promise.resolve();

		const ok = exchange.submit("ok");
		stdout.write("ok\r\n");
		stdout.write("fresh\r\n");
		stdout.write(stablePrompt(4));
		clock.advance(PROMPT_STABLE_MS);
		assert.equal(await ok, "fresh");
		assert.deepEqual(writes, ["hang\n", "ok\n"]);
		stdout.end();
	});

	test("closed stdout resolves with console closed", async () => {
		const clock = createFakeClock();
		const stdout = new PassThrough();
		const exchange = createConsoleExchange({
			stdout,
			clock,
			write() {},
		});

		const pending = exchange.submit("help");
		stdout.write("help\r\n");
		stdout.end();
		assert.equal(await pending, "console closed");
		assert.equal(await exchange.submit("again"), "console closed");
	});
});
