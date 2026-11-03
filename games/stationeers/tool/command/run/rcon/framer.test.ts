import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createConsoleReplyFramer,
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

async function frameReply(
	submittedLine: string,
	chunks: Array<string | Buffer>,
	afterPush?: (clock: FakeClock) => void,
): Promise<string> {
	const clock = createFakeClock();
	const framer = createConsoleReplyFramer(submittedLine, { clock });
	for (const chunk of chunks) {
		framer.push(chunk);
	}
	afterPush?.(clock);
	return framer.done;
}

function home(row: number): string {
	return `\x1b[${row};1H`;
}

function stablePrompt(row: number): string {
	return `${home(row)}> `;
}

describe("console reply framer", () => {
	test("C1 — command text without prompt or echo", async () => {
		const body = await frameReply(
			"help",
			[
				"help\r\n",
				stablePrompt(5),
				"\x1b[2K",
				home(5),
				"Tags: [launch]\r\n",
				stablePrompt(6),
			],
			(clock) => clock.advance(PROMPT_STABLE_MS),
		);
		assert.equal(body, "Tags: [launch]");
		assert.equal(body.includes("help"), false);
		assert.equal(body.includes(">"), false);
	});

	test("C2 — cleared prompt does not end the reply", async () => {
		const body = await frameReply(
			"save",
			[
				"Saving\r\n",
				stablePrompt(1),
				"\x1b[2K",
				home(1),
				"still saving\r\n",
				stablePrompt(1),
			],
			(clock) => {
				clock.advance(100);
				clock.advance(PROMPT_STABLE_MS);
			},
		);
		assert.match(body, /Saving/);
		assert.match(body, /still saving/);
	});

	test("C3 — lines after a stable prompt are excluded", async () => {
		const clock = createFakeClock();
		const framer = createConsoleReplyFramer("save", { clock });
		framer.push("Saving\r\n");
		framer.push(stablePrompt(1));
		clock.advance(PROMPT_STABLE_MS);
		const bodyPromise = framer.done;
		framer.push("Created new save\r\n");
		clock.advance(1000);
		const body = await bodyPromise;
		assert.equal(body, "Saving");
		assert.equal(body.includes("Created new save"), false);
	});

	test("C4 — no console output yields empty body", async () => {
		const body = await frameReply(
			"help",
			["help\r\n", stablePrompt(1)],
			(clock) => clock.advance(PROMPT_STABLE_MS),
		);
		assert.equal(body, "");
	});

	test("C5 — cursor-address and color bytes are removed from the body", async () => {
		const body = await frameReply(
			"help",
			[
				"\x1b[37m\x1b[48;1HPlain reply\r\n",
				"\x1b[2K",
				stablePrompt(48),
			],
			(clock) => clock.advance(PROMPT_STABLE_MS),
		);
		assert.equal(body, "Plain reply");
		const raw = Buffer.from(
			"\x1b[37m\x1b[48;1HPlain reply\r\n\x1b[2K\x1b[48;1H> ",
			"utf8",
		);
		assert.equal(raw.includes(Buffer.from("\x1b[37m", "utf8")), true);
	});

	test("prompt at column 0 after cursor home and spaces", async () => {
		const clock = createFakeClock();
		const framer = createConsoleReplyFramer("help", { clock });
		framer.push(`${home(48)}   ${home(48)}> `);
		clock.advance(100);
		assert.equal(clock.now(), 100);
		clock.advance(PROMPT_STABLE_MS);
		const body = await framer.done;
		assert.equal(body, "");
	});
});
