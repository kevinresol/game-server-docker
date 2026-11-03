import net from "node:net";
import {
	decodePacket,
	encodePacket,
	encodeResponseValuePackets,
	isEmptyResponseValueMarker,
	SERVERDATA_AUTH,
	SERVERDATA_AUTH_RESPONSE,
	SERVERDATA_EXECCOMMAND,
	SERVERDATA_RESPONSE_VALUE,
	type RconPacket,
} from "./protocol";

export type ReadSecretResult =
	| { ok: true; secret: string }
	| { ok: false };

export type ReadSecretFn = () => ReadSecretResult | Promise<ReadSecretResult>;

export type ExecuteFn = (body: string) => string | Promise<string>;

export type RconServerOptions = {
	port: number;
	host?: string;
	readSecret: ReadSecretFn;
	execute: ExecuteFn;
};

export type RconServerHandle = {
	server: net.Server;
	port: number;
	address: string;
	close: () => Promise<void>;
};

const COMMAND_REJECTED = "command rejected";

function bodyContainsLineBreak(body: string): boolean {
	return body.includes("\n") || body.includes("\r");
}

function writePacket(socket: net.Socket, id: number, type: number, body: string): void {
	socket.write(encodePacket(id, type, body));
}

function writeResponseBody(socket: net.Socket, id: number, body: string): void {
	for (const packet of encodeResponseValuePackets(id, body)) {
		socket.write(packet);
	}
}

async function handleAuth(
	socket: net.Socket,
	packet: RconPacket,
	readSecret: ReadSecretFn,
	setAuthenticated: (value: boolean) => void,
): Promise<void> {
	const secretResult = await readSecret();
	const expected = secretResult.ok ? secretResult.secret : null;
	if (expected !== null && packet.body === expected) {
		writePacket(socket, packet.id, SERVERDATA_RESPONSE_VALUE, "");
		writePacket(socket, packet.id, SERVERDATA_AUTH_RESPONSE, "");
		setAuthenticated(true);
		return;
	}
	writePacket(socket, -1, SERVERDATA_AUTH_RESPONSE, "");
}

async function handleExec(
	socket: net.Socket,
	packet: RconPacket,
	execute: ExecuteFn,
	onExecResponseComplete: () => void,
): Promise<void> {
	const { id, body } = packet;
	if (body.length === 0) {
		writePacket(socket, id, SERVERDATA_RESPONSE_VALUE, "");
		onExecResponseComplete();
		return;
	}
	if (bodyContainsLineBreak(body)) {
		writePacket(socket, id, SERVERDATA_RESPONSE_VALUE, COMMAND_REJECTED);
		onExecResponseComplete();
		return;
	}
	const reply = await execute(body);
	writeResponseBody(socket, id, reply);
	onExecResponseComplete();
}

function handleConnection(
	socket: net.Socket,
	readSecret: ReadSecretFn,
	execute: ExecuteFn,
): void {
	let buffer = Buffer.alloc(0);
	let authenticated = false;
	let mayMirrorEndMarker = false;
	let processing = Promise.resolve();

	const processBuffer = async (): Promise<void> => {
		while (buffer.length > 0) {
			const decoded = decodePacket(buffer, 0);
			if (!decoded.ok) {
				if (decoded.reason === "incomplete") {
					return;
				}
				socket.destroy();
				return;
			}
			buffer = buffer.subarray(decoded.bytesRead);
			const packet = decoded.packet;

			if (packet.type === SERVERDATA_AUTH) {
				await handleAuth(socket, packet, readSecret, (value) => {
					authenticated = value;
				});
				continue;
			}

			if (packet.type === SERVERDATA_EXECCOMMAND) {
				if (!authenticated) {
					socket.destroy();
					return;
				}
				mayMirrorEndMarker = false;
				await handleExec(socket, packet, execute, () => {
					mayMirrorEndMarker = true;
				});
				continue;
			}

			if (isEmptyResponseValueMarker(packet)) {
				if (authenticated && mayMirrorEndMarker) {
					writePacket(socket, packet.id, SERVERDATA_RESPONSE_VALUE, "");
					mayMirrorEndMarker = false;
				}
				continue;
			}
		}
	};

	const scheduleProcess = (): void => {
		processing = processing.then(() => processBuffer()).catch(() => {
			socket.destroy();
		});
	};

	socket.on("data", (chunk) => {
		buffer = Buffer.concat([buffer, chunk]);
		scheduleProcess();
	});
}

export function createRconServer(options: RconServerOptions): Promise<RconServerHandle> {
	const host = options.host ?? "0.0.0.0";
	const server = net.createServer((socket) => {
		handleConnection(socket, options.readSecret, options.execute);
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port, host, () => {
			server.off("error", reject);
			const address = server.address();
			const boundPort =
				typeof address === "object" && address !== null ? address.port : options.port;
			resolve({
				server,
				port: boundPort,
				address: host,
				close: () =>
					new Promise((closeResolve, closeReject) => {
						server.close((err) => {
							if (err) {
								closeReject(err);
								return;
							}
							closeResolve();
						});
					}),
			});
		});
	});
}
