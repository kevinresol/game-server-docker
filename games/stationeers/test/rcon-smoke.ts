import net from "node:net";
import {
	decodePackets,
	encodePacket,
	SERVERDATA_AUTH,
	SERVERDATA_AUTH_RESPONSE,
	SERVERDATA_EXECCOMMAND,
	SERVERDATA_RESPONSE_VALUE,
} from "../tool/command/run/rcon/protocol.ts";

const host = process.argv[2] ?? "127.0.0.1";
const port = Number(process.argv[3] ?? 27500);
const password = process.argv[4] ?? "change-this-rcon-secret";
const command = process.argv[5] ?? "help";

function collect(socket: net.Socket, idleMs = 500): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let buf = Buffer.alloc(0);
		let timer: NodeJS.Timeout | undefined;
		const reset = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				socket.off("data", onData);
				resolve(buf);
			}, idleMs);
		};
		const onData = (chunk: Buffer) => {
			buf = Buffer.concat([buf, chunk]);
			reset();
		};
		socket.on("data", onData);
		socket.on("error", reject);
		reset();
	});
}

async function main(): Promise<void> {
	const socket = net.connect(port, host);
	const requestId = 42;

	socket.write(encodePacket(requestId, SERVERDATA_AUTH, password));

	const authOk = await (async () => {
		const buf = await collect(socket, 800);
		const decoded = decodePackets(buf);
		for (const p of decoded.packets) {
			if (p.type === SERVERDATA_AUTH_RESPONSE && p.id === requestId) return true;
			if (p.type === SERVERDATA_AUTH_RESPONSE && p.id === -1) return false;
		}
		return false;
	})();

	if (!authOk) {
		console.error("RCON auth failed");
		process.exit(1);
	}

	socket.write(encodePacket(requestId, SERVERDATA_EXECCOMMAND, command));
	const execBuf = await collect(socket, 1200);
	const execDecoded = decodePackets(execBuf);
	let body = "";
	for (const p of execDecoded.packets) {
		if (p.type === SERVERDATA_RESPONSE_VALUE && p.id === requestId) {
			body += p.body;
		}
	}
	console.log("RCON auth OK");
	console.log("RCON exec body (first 400 chars):");
	console.log(body.slice(0, 400));
	socket.end();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
