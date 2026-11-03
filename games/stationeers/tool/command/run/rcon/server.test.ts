import assert from "node:assert/strict";
import net from "node:net";
import { after, before, describe, test } from "node:test";
import {
	decodePacket,
	decodePackets,
	encodePacket,
	encodeResponseValuePackets,
	RCON_MAX_BODY_BYTES,
	SERVERDATA_AUTH,
	SERVERDATA_AUTH_RESPONSE,
	SERVERDATA_EXECCOMMAND,
	SERVERDATA_RESPONSE_VALUE,
	type RconPacket,
} from "./protocol";
import {
	createRconServer,
	type ExecuteFn,
	type ReadSecretFn,
	type RconServerHandle,
} from "./server";

const TEST_SECRET = "test-rcon-secret-value";

function readAllPackets(socket: net.Socket, timeoutMs = 2000): Promise<RconPacket[]> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error("timed out waiting for packets"));
		}, timeoutMs);

		socket.on("data", (chunk) => {
			chunks.push(chunk);
		});
		socket.on("error", reject);
		socket.on("close", () => {
			clearTimeout(timer);
			const combined = Buffer.concat(chunks);
			const { packets } = decodePackets(combined);
			resolve(packets);
		});
		socket.on("end", () => {
			// keep socket open until close unless server half-closes
		});
	});
}

function collectPacketsUntilIdle(
	socket: net.Socket,
	idleMs = 150,
	timeoutMs = 2000,
): Promise<RconPacket[]> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let idleTimer: ReturnType<typeof setTimeout> | undefined;
		const hardTimer = setTimeout(() => {
			socket.destroy();
			reject(new Error("timed out collecting packets"));
		}, timeoutMs);

		const finish = (): void => {
			clearTimeout(hardTimer);
			if (idleTimer !== undefined) {
				clearTimeout(idleTimer);
			}
			const combined = Buffer.concat(chunks);
			const { packets } = decodePackets(combined);
			resolve(packets);
		};

		const bumpIdle = (): void => {
			if (idleTimer !== undefined) {
				clearTimeout(idleTimer);
			}
			idleTimer = setTimeout(finish, idleMs);
		};

		socket.on("data", (chunk) => {
			chunks.push(chunk);
			bumpIdle();
		});
		socket.on("error", reject);
		socket.on("close", finish);
		bumpIdle();
	});
}

async function connect(port: number): Promise<net.Socket> {
	return new Promise((resolve, reject) => {
		const socket = net.connect({ port, host: "127.0.0.1" }, () => resolve(socket));
		socket.once("error", reject);
	});
}

async function withServer(
	readSecret: ReadSecretFn,
	execute: ExecuteFn,
	run: (handle: RconServerHandle) => Promise<void>,
): Promise<void> {
	const handle = await createRconServer({ port: 0, readSecret, execute });
	try {
		await run(handle);
	} finally {
		await handle.close();
	}
}

describe("createRconServer", () => {
	test("D1 — auth success shape and following exec accepted", async () => {
		const executeCalls: string[] = [];
		await withServer(
			() => ({ ok: true, secret: TEST_SECRET }),
			async (body) => {
				executeCalls.push(body);
				return "Tags: [launch]";
			},
			async (handle) => {
				assert.equal(handle.address, "0.0.0.0");
				const socket = await connect(handle.port);
				const authId = 11;
				socket.write(encodePacket(authId, SERVERDATA_AUTH, TEST_SECRET));
				const authPackets = await collectPacketsUntilIdle(socket);
				assert.equal(authPackets.length, 2);
				assert.deepEqual(authPackets[0], {
					id: authId,
					type: SERVERDATA_RESPONSE_VALUE,
					body: "",
				});
				assert.deepEqual(authPackets[1], {
					id: authId,
					type: SERVERDATA_AUTH_RESPONSE,
					body: "",
				});

				const execId = 22;
				socket.write(encodePacket(execId, SERVERDATA_EXECCOMMAND, "help"));
				const execPackets = await collectPacketsUntilIdle(socket);
				assert.deepEqual(execPackets, [
					{ id: execId, type: SERVERDATA_RESPONSE_VALUE, body: "Tags: [launch]" },
				]);
				assert.deepEqual(executeCalls, ["help"]);
				socket.end();
			},
		);
	});

	test("D2 — auth failure leaves connection open and does not execute", async () => {
		let executeCalled = false;
		await withServer(
			() => ({ ok: true, secret: TEST_SECRET }),
			() => {
				executeCalled = true;
				return "";
			},
			async (handle) => {
				const socket = await connect(handle.port);
				socket.write(encodePacket(5, SERVERDATA_AUTH, "wrong-password"));
				const authPackets = await collectPacketsUntilIdle(socket);
				assert.deepEqual(authPackets, [
					{ id: -1, type: SERVERDATA_AUTH_RESPONSE, body: "" },
				]);

				socket.write(encodePacket(6, SERVERDATA_AUTH, TEST_SECRET));
				const retryPackets = await collectPacketsUntilIdle(socket);
				assert.equal(retryPackets.length, 2);
				assert.equal(retryPackets[1]!.type, SERVERDATA_AUTH_RESPONSE);
				assert.equal(executeCalled, false);
				socket.end();
			},
		);
	});

	test("D3 — exec body uses exec request id", async () => {
		await withServer(
			() => ({ ok: true, secret: TEST_SECRET }),
			async () => "Tags: [launch]",
			async (handle) => {
				const socket = await connect(handle.port);
				socket.write(encodePacket(1, SERVERDATA_AUTH, TEST_SECRET));
				await collectPacketsUntilIdle(socket);

				const execId = 42;
				socket.write(encodePacket(execId, SERVERDATA_EXECCOMMAND, "help"));
				const packets = await collectPacketsUntilIdle(socket);
				assert.deepEqual(packets, [
					{ id: execId, type: SERVERDATA_RESPONSE_VALUE, body: "Tags: [launch]" },
				]);
				socket.end();
			},
		);
	});

	test("D4 — split body and end marker mirror", async () => {
		const longReply = "z".repeat(RCON_MAX_BODY_BYTES + 50);
		await withServer(
			() => ({ ok: true, secret: TEST_SECRET }),
			async () => longReply,
			async (handle) => {
				const socket = await connect(handle.port);
				socket.write(encodePacket(1, SERVERDATA_AUTH, TEST_SECRET));
				await collectPacketsUntilIdle(socket);

				const execId = 7;
				const markerId = 88;
				socket.write(
					Buffer.concat([
						encodePacket(execId, SERVERDATA_EXECCOMMAND, "big"),
						encodePacket(markerId, SERVERDATA_RESPONSE_VALUE, ""),
					]),
				);
				const packets = await collectPacketsUntilIdle(socket, 200, 5000);
				const responseBodies = packets
					.filter((p) => p.type === SERVERDATA_RESPONSE_VALUE && p.id === execId)
					.map((p) => p.body)
					.join("");
				assert.equal(responseBodies, longReply);
				const mirrored = packets.filter(
					(p) => p.type === SERVERDATA_RESPONSE_VALUE && p.id === markerId,
				);
				assert.deepEqual(mirrored, [
					{ id: markerId, type: SERVERDATA_RESPONSE_VALUE, body: "" },
				]);
				socket.end();
			},
		);
	});

	test("D5 — exec before auth closes connection without execute", async () => {
		let executeCalled = false;
		await withServer(
			() => ({ ok: true, secret: TEST_SECRET }),
			() => {
				executeCalled = true;
				return "";
			},
			async (handle) => {
				const socket = await connect(handle.port);
				socket.write(encodePacket(3, SERVERDATA_EXECCOMMAND, "help"));
				const packets = await readAllPackets(socket);
				assert.equal(packets.length, 0);
				assert.equal(executeCalled, false);
			},
		);
	});

	test("D7 — empty exec does not call execute", async () => {
		let executeCalled = false;
		await withServer(
			() => ({ ok: true, secret: TEST_SECRET }),
			() => {
				executeCalled = true;
				return "should-not-run";
			},
			async (handle) => {
				const socket = await connect(handle.port);
				socket.write(encodePacket(1, SERVERDATA_AUTH, TEST_SECRET));
				await collectPacketsUntilIdle(socket);

				const execId = 9;
				socket.write(encodePacket(execId, SERVERDATA_EXECCOMMAND, ""));
				const packets = await collectPacketsUntilIdle(socket);
				assert.deepEqual(packets, [
					{ id: execId, type: SERVERDATA_RESPONSE_VALUE, body: "" },
				]);
				assert.equal(executeCalled, false);
				socket.end();
			},
		);
	});

	test("exec body with newline returns command rejected without execute", async () => {
		let executeCalled = false;
		await withServer(
			() => ({ ok: true, secret: TEST_SECRET }),
			() => {
				executeCalled = true;
				return "";
			},
			async (handle) => {
				const socket = await connect(handle.port);
				socket.write(encodePacket(1, SERVERDATA_AUTH, TEST_SECRET));
				await collectPacketsUntilIdle(socket);

				const execId = 4;
				socket.write(encodePacket(execId, SERVERDATA_EXECCOMMAND, "a\nb"));
				const packets = await collectPacketsUntilIdle(socket);
				assert.deepEqual(packets, [
					{
						id: execId,
						type: SERVERDATA_RESPONSE_VALUE,
						body: "command rejected",
					},
				]);
				assert.equal(executeCalled, false);
				socket.end();
			},
		);
	});

	test("D8 — split TCP reads do not treat truncated auth as success", async () => {
		await withServer(
			() => ({ ok: true, secret: TEST_SECRET }),
			async () => "ok",
			async (handle) => {
				const socket = await connect(handle.port);
				const authPacket = encodePacket(10, SERVERDATA_AUTH, TEST_SECRET);
				const splitAt = authPacket.length - 4;
				socket.write(authPacket.subarray(0, splitAt));

				let earlyBytes = 0;
				const earlyListener = (): void => {
					earlyBytes++;
				};
				socket.on("data", earlyListener);
				await new Promise((r) => setTimeout(r, 80));
				assert.equal(earlyBytes, 0);
				socket.off("data", earlyListener);

				const execPacket = encodePacket(20, SERVERDATA_EXECCOMMAND, "help");
				const markerPacket = encodePacket(30, SERVERDATA_RESPONSE_VALUE, "");
				const collecting = collectPacketsUntilIdle(socket);
				socket.write(
					Buffer.concat([
						authPacket.subarray(splitAt),
						execPacket,
						markerPacket,
					]),
				);

				const packets = await collecting;
				assert.equal(
					packets.filter((p) => p.type === SERVERDATA_AUTH_RESPONSE).length,
					1,
				);
				const execResponses = packets.filter(
					(p) => p.type === SERVERDATA_RESPONSE_VALUE && p.body === "ok",
				);
				assert.equal(execResponses.length, 1);
				socket.end();
			},
		);
	});

	test("D9 — readSecret on each auth; failed read fail-closed; session keeps exec", async () => {
		let secret: string | null = TEST_SECRET;
		let readFailed = false;
		const readSecret: ReadSecretFn = () => {
			if (readFailed) {
				return { ok: false };
			}
			if (secret === null) {
				return { ok: false };
			}
			return { ok: true, secret };
		};
		const executeBodies: string[] = [];

		await withServer(
			readSecret,
			async (body) => {
				executeBodies.push(body);
				return `reply:${body}`;
			},
			async (handle) => {
				const first = await connect(handle.port);
				first.write(encodePacket(1, SERVERDATA_AUTH, TEST_SECRET));
				await collectPacketsUntilIdle(first);

				secret = "rotated-secret";
				const second = await connect(handle.port);
				second.write(encodePacket(2, SERVERDATA_AUTH, TEST_SECRET));
				const oldSecretAttempt = await collectPacketsUntilIdle(second);
				assert.deepEqual(oldSecretAttempt, [
					{ id: -1, type: SERVERDATA_AUTH_RESPONSE, body: "" },
				]);

				second.write(encodePacket(3, SERVERDATA_AUTH, "rotated-secret"));
				const newSecretAuth = await collectPacketsUntilIdle(second);
				assert.equal(newSecretAuth.length, 2);

				readFailed = true;
				const third = await connect(handle.port);
				third.write(encodePacket(4, SERVERDATA_AUTH, "rotated-secret"));
				const failedReadAuth = await collectPacketsUntilIdle(third);
				assert.deepEqual(failedReadAuth, [
					{ id: -1, type: SERVERDATA_AUTH_RESPONSE, body: "" },
				]);

				first.write(encodePacket(50, SERVERDATA_EXECCOMMAND, "still-session"));
				const sessionExec = await collectPacketsUntilIdle(first);
				assert.deepEqual(sessionExec, [
					{
						id: 50,
						type: SERVERDATA_RESPONSE_VALUE,
						body: "reply:still-session",
					},
				]);

				first.end();
				second.end();
				third.end();
			},
		);

		assert.deepEqual(executeBodies, ["still-session"]);
	});

	test("missing secret read authenticates nobody", async () => {
		await withServer(
			() => ({ ok: false }),
			async () => "nope",
			async (handle) => {
				const socket = await connect(handle.port);
				socket.write(encodePacket(1, SERVERDATA_AUTH, ""));
				const packets = await collectPacketsUntilIdle(socket);
				assert.deepEqual(packets, [
					{ id: -1, type: SERVERDATA_AUTH_RESPONSE, body: "" },
				]);
				socket.end();
			},
		);
	});
});

describe("server.test logging", () => {
	let logSpy: typeof console.log;

	before(() => {
		logSpy = console.log;
		console.log = () => {};
	});

	after(() => {
		console.log = logSpy;
	});

	test("logs do not contain the secret string", async () => {
		const logged: string[] = [];
		console.log = (...args: unknown[]) => {
			logged.push(args.map(String).join(" "));
		};
		await withServer(
			() => ({ ok: true, secret: TEST_SECRET }),
			async () => "ok",
			async (handle) => {
				const socket = await connect(handle.port);
				socket.write(encodePacket(1, SERVERDATA_AUTH, TEST_SECRET));
				await collectPacketsUntilIdle(socket);
				socket.write(encodePacket(2, SERVERDATA_AUTH, "bad"));
				await collectPacketsUntilIdle(socket);
				socket.end();
			},
		);
		const combined = logged.join("\n");
		assert.equal(combined.includes(TEST_SECRET), false);
	});
});
