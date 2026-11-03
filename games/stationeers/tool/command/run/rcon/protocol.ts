/** Valve Source RCON packet limits (size field excludes itself). */
export const RCON_MAX_PACKET_BYTES = 4096;
export const RCON_MAX_SIZE_FIELD = 4092;
/** Max UTF-8 body bytes in one packet: id + type + body + two terminators fit in size field. */
export const RCON_MAX_BODY_BYTES = RCON_MAX_SIZE_FIELD - 10;

export const SERVERDATA_RESPONSE_VALUE = 0;
export const SERVERDATA_AUTH_RESPONSE = 2;
export const SERVERDATA_EXECCOMMAND = 2;
export const SERVERDATA_AUTH = 3;

export type RconPacket = {
	id: number;
	type: number;
	body: string;
};

export type DecodePacketResult =
	| { ok: true; packet: RconPacket; bytesRead: number }
	| { ok: false; reason: "incomplete" }
	| { ok: false; reason: "invalid" };

const HEADER_BYTES = 4;
const ID_TYPE_BYTES = 8;
const TERMINATOR_BYTES = 2;
const MIN_SIZE_FIELD = ID_TYPE_BYTES + TERMINATOR_BYTES;

export function stripNullBytes(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) !== 0) {
			out += text[i]!;
		}
	}
	return out;
}

function splitBodyUtf8(text: string, maxBytes: number): string[] {
	if (text.length === 0) {
		return [""];
	}
	const chunks: string[] = [];
	let start = 0;
	while (start < text.length) {
		let end = start;
		let byteLen = 0;
		while (end < text.length) {
			const char = text[end]!;
			const charBytes = Buffer.byteLength(char, "utf8");
			if (byteLen + charBytes > maxBytes) {
				break;
			}
			byteLen += charBytes;
			end++;
		}
		if (end === start) {
			throw new Error("RCON body contains a UTF-8 code point that exceeds the packet limit");
		}
		chunks.push(text.slice(start, end));
		start = end;
	}
	return chunks;
}

export function encodePacket(id: number, type: number, body: string): Buffer {
	const sanitized = stripNullBytes(body);
	const bodyBuf = Buffer.from(sanitized, "utf8");
	const sizeField = ID_TYPE_BYTES + bodyBuf.length + TERMINATOR_BYTES;
	if (sizeField > RCON_MAX_SIZE_FIELD) {
		throw new Error(`RCON packet body exceeds ${RCON_MAX_BODY_BYTES} bytes`);
	}
	const packet = Buffer.allocUnsafe(HEADER_BYTES + sizeField);
	packet.writeInt32LE(sizeField, 0);
	packet.writeInt32LE(id, HEADER_BYTES);
	packet.writeInt32LE(type, HEADER_BYTES + 4);
	bodyBuf.copy(packet, HEADER_BYTES + ID_TYPE_BYTES);
	packet[HEADER_BYTES + ID_TYPE_BYTES + bodyBuf.length] = 0;
	packet[HEADER_BYTES + ID_TYPE_BYTES + bodyBuf.length + 1] = 0;
	return packet;
}

/** Encode one or more response-value packets for a console reply body. */
export function encodeResponseValuePackets(id: number, body: string): Buffer[] {
	const sanitized = stripNullBytes(body);
	const parts = splitBodyUtf8(sanitized, RCON_MAX_BODY_BYTES);
	return parts.map((part) => encodePacket(id, SERVERDATA_RESPONSE_VALUE, part));
}

export function decodePacket(buffer: Buffer, offset = 0): DecodePacketResult {
	if (buffer.length - offset < HEADER_BYTES) {
		return { ok: false, reason: "incomplete" };
	}
	const sizeField = buffer.readInt32LE(offset);
	if (sizeField < MIN_SIZE_FIELD || sizeField > RCON_MAX_SIZE_FIELD) {
		return { ok: false, reason: "invalid" };
	}
	const totalBytes = HEADER_BYTES + sizeField;
	if (totalBytes > RCON_MAX_PACKET_BYTES) {
		return { ok: false, reason: "invalid" };
	}
	if (buffer.length - offset < totalBytes) {
		return { ok: false, reason: "incomplete" };
	}
	const payloadStart = offset + HEADER_BYTES;
	const payloadEnd = payloadStart + sizeField;
	if (buffer[payloadEnd - 1] !== 0 || buffer[payloadEnd - 2] !== 0) {
		return { ok: false, reason: "invalid" };
	}
	let bodyEnd = payloadStart + ID_TYPE_BYTES;
	while (bodyEnd < payloadEnd && buffer[bodyEnd] !== 0) {
		bodyEnd++;
	}
	if (bodyEnd !== payloadEnd - TERMINATOR_BYTES) {
		return { ok: false, reason: "invalid" };
	}
	const body = buffer.toString("utf8", payloadStart + ID_TYPE_BYTES, bodyEnd);
	return {
		ok: true,
		packet: {
			id: buffer.readInt32LE(payloadStart),
			type: buffer.readInt32LE(payloadStart + 4),
			body,
		},
		bytesRead: totalBytes,
	};
}

export function decodePackets(buffer: Buffer): { packets: RconPacket[]; rest: Buffer } {
	const packets: RconPacket[] = [];
	let offset = 0;
	while (offset < buffer.length) {
		const result = decodePacket(buffer, offset);
		if (!result.ok) {
			break;
		}
		packets.push(result.packet);
		offset += result.bytesRead;
	}
	return { packets, rest: buffer.subarray(offset) };
}

export function isEmptyResponseValueMarker(packet: RconPacket): boolean {
	return packet.type === SERVERDATA_RESPONSE_VALUE && packet.body === "";
}
