/** Idle console prompt stability window (milliseconds). */
export const PROMPT_STABLE_MS = 300;

export type FramerTimer = {
	clear(): void;
};

export type FramerClock = {
	now(): number;
	setTimeout(fn: () => void, ms: number): FramerTimer;
};

const realClock: FramerClock = {
	now: () => Date.now(),
	setTimeout(fn, ms) {
		const handle = setTimeout(fn, ms);
		return { clear: () => clearTimeout(handle) };
	},
};

export type ConsoleReplyFramer = {
	push(data: Buffer | Uint8Array | string): void;
	readonly done: Promise<string>;
};

export type CreateConsoleReplyFramerOptions = {
	clock?: FramerClock;
};

/**
 * Frames console stdout into one RCON reply body for a submitted command line.
 * Detects a stable `> ` prompt at column 0; strips ANSI and drops one command echo.
 */
export function createConsoleReplyFramer(
	submittedLine: string,
	options: CreateConsoleReplyFramerOptions = {},
): ConsoleReplyFramer {
	const clock = options.clock ?? realClock;
	let column = 0;
	let currentLine = "";
	const bodyLines: string[] = [];
	let echoDropped = false;
	let pendingPrompt: FramerTimer | undefined;
	let finished = false;
	let escapeBuf = "";

	let resolveDone!: (body: string) => void;
	const done = new Promise<string>((resolve) => {
		resolveDone = resolve;
	});

	function clearPendingPrompt(): void {
		pendingPrompt?.clear();
		pendingPrompt = undefined;
	}

	function cancelPromptBecauseCleared(): void {
		clearPendingPrompt();
	}

	function scheduleStablePrompt(): void {
		if (finished) return;
		clearPendingPrompt();
		pendingPrompt = clock.setTimeout(() => {
			pendingPrompt = undefined;
			completeReply();
		}, PROMPT_STABLE_MS);
	}

	function setColumn(nextColumn: number): void {
		column = Math.max(0, nextColumn);
		if (column === 0) {
			cancelPromptBecauseCleared();
		}
	}

	function clearLineFromCursor(): void {
		currentLine = currentLine.slice(0, column);
		cancelPromptBecauseCleared();
	}

	function clearWholeLine(): void {
		currentLine = "";
		column = 0;
		cancelPromptBecauseCleared();
	}

	function isPromptLine(line: string): boolean {
		return line === "> " || line === ">";
	}

	function maybeCommitLine(): void {
		if (currentLine.length === 0) return;
		const line = currentLine;
		currentLine = "";
		if (!echoDropped && line === submittedLine) {
			echoDropped = true;
			return;
		}
		if (isPromptLine(line)) return;
		bodyLines.push(line);
	}

	function checkPromptAtCursor(): void {
		if (column === 2 && currentLine === "> ") {
			scheduleStablePrompt();
		}
	}

	function writeVisible(char: string): void {
		if (finished) return;
		if (column < currentLine.length) {
			currentLine = currentLine.slice(0, column);
		}
		while (currentLine.length < column) {
			currentLine += " ";
		}
		currentLine += char;
		column += 1;
		checkPromptAtCursor();
	}

	function applyCsi(params: string, command: string): void {
		switch (command) {
			case "H":
			case "f": {
				const parts = params.split(";");
				const colPart = parts.length >= 2 ? parts[1] : "1";
				const col = Number.parseInt(colPart, 10);
				setColumn(Number.isFinite(col) && col > 0 ? col - 1 : 0);
				return;
			}
			case "G": {
				const col = Number.parseInt(params, 10);
				setColumn(Number.isFinite(col) && col > 0 ? col - 1 : 0);
				return;
			}
			case "K": {
				const mode = params.length === 0 ? 0 : Number.parseInt(params, 10);
				if (mode === 2) clearWholeLine();
				else if (mode === 1) {
					currentLine = currentLine.slice(0, column);
					cancelPromptBecauseCleared();
				} else clearLineFromCursor();
				return;
			}
			default:
				return;
		}
	}

	function consumeText(text: string): void {
		for (let i = 0; i < text.length; i += 1) {
			if (finished) return;
			const code = text.charCodeAt(i);
			if (code === 0x1b) {
				escapeBuf = "\x1b";
				continue;
			}
			if (escapeBuf.length > 0) {
				escapeBuf += text[i];
				if (escapeBuf.startsWith("\x1b]")) {
					if (code === 0x07 || escapeBuf.endsWith("\x1b\\")) {
						escapeBuf = "";
					}
					continue;
				}
				if (escapeBuf === "\x1b") {
					continue;
				}
				if (escapeBuf.length === 2 && escapeBuf.startsWith("\x1b") && escapeBuf[1] !== "[") {
					escapeBuf = "";
					i -= 1;
					continue;
				}
				if (escapeBuf.startsWith("\x1b[")) {
					const body = escapeBuf.slice(2);
					const last = body.charCodeAt(body.length - 1);
					if (last >= 0x40 && last <= 0x7e) {
						applyCsi(body.slice(0, -1), body.slice(-1));
						escapeBuf = "";
					}
					continue;
				}
				escapeBuf = "";
				i -= 1;
				continue;
			}
			if (code === 0x0d) {
				setColumn(0);
				continue;
			}
			if (code === 0x0a) {
				maybeCommitLine();
				column = 0;
				continue;
			}
			writeVisible(text[i] ?? "");
		}
	}

	function completeReply(): void {
		if (finished) return;
		finished = true;
		clearPendingPrompt();
		if (currentLine.length > 0 && !isPromptLine(currentLine)) {
			maybeCommitLine();
		} else {
			currentLine = "";
		}
		resolveDone(bodyLines.join("\n"));
	}

	return {
		push(data) {
			if (finished) return;
			const text =
				typeof data === "string"
					? data
					: Buffer.from(data instanceof Buffer ? data : data).toString("utf8");
			consumeText(text);
		},
		done,
	};
}
