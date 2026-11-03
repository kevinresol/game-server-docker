import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	decodePacket,
	decodePackets,
	encodePacket,
	encodeResponseValuePackets,
	isEmptyResponseValueMarker,
	RCON_MAX_BODY_BYTES,
	RCON_MAX_PACKET_BYTES,
	RCON_MAX_SIZE_FIELD,
	SERVERDATA_AUTH,
	SERVERDATA_AUTH_RESPONSE,
	SERVERDATA_EXECCOMMAND,
	SERVERDATA_RESPONSE_VALUE,
	stripNullBytes,
} from "./protocol";

function readFields(buf: Buffer): {
	size: number;
	id: number;
	type: number;
	body: string;
	trailingNull: number;
} {
	const size = buf.readInt32LE(0);
	const id = buf.readInt32LE(4);
	const type = buf.readInt32LE(8);
	const bodyStart = 12;
	let bodyEnd = bodyStart;
	while (bodyEnd < 4 + size - 1 && buf[bodyEnd] !== 0) {
		bodyEnd++;
	}
	const body = buf.toString("utf8", bodyStart, bodyEnd);
	const trailingNull = buf[4 + size - 1]!;
	return { size, id, type, body, trailingNull };
}

describe("encodePacket", () => {
	test("auth type 3", () => {
		const buf = encodePacket(7, SERVERDATA_AUTH, "secret");
		assert.equal(buf.length, 4 + 10 + 6);
		const fields = readFields(buf);
		assert.equal(fields.size, 16);
		assert.equal(fields.id, 7);
		assert.equal(fields.type, SERVERDATA_AUTH);
		assert.equal(fields.body, "secret");
		assert.equal(fields.trailingNull, 0);
	});

	test("exec type 2", () => {
		const buf = encodePacket(42, SERVERDATA_EXECCOMMAND, "help");
		const fields = readFields(buf);
		assert.equal(fields.type, SERVERDATA_EXECCOMMAND);
		assert.equal(fields.id, 42);
		assert.equal(fields.body, "help");
	});

	test("response-value type 0", () => {
		const buf = encodePacket(42, SERVERDATA_RESPONSE_VALUE, "Tags: [launch]");
		const fields = readFields(buf);
		assert.equal(fields.type, SERVERDATA_RESPONSE_VALUE);
		assert.equal(fields.body, "Tags: [launch]");
	});

	test("auth-response type 2 with id -1", () => {
		const buf = encodePacket(-1, SERVERDATA_AUTH_RESPONSE, "");
		const fields = readFields(buf);
		assert.equal(fields.type, SERVERDATA_AUTH_RESPONSE);
		assert.equal(fields.id, -1);
		assert.equal(fields.body, "");
		assert.equal(buf.readInt32LE(4), -1);
	});

	test("empty end-marker packet", () => {
		const buf = encodePacket(99, SERVERDATA_RESPONSE_VALUE, "");
		assert.equal(buf.length, 14);
		const decoded = decodePacket(buf);
		assert.equal(decoded.ok, true);
		if (decoded.ok) {
			assert.equal(decoded.packet.type, SERVERDATA_RESPONSE_VALUE);
			assert.equal(decoded.packet.id, 99);
			assert.equal(decoded.packet.body, "");
			assert.equal(isEmptyResponseValueMarker(decoded.packet), true);
		}
	});

	test("strips null bytes from body before encoding", () => {
		const buf = encodePacket(1, SERVERDATA_RESPONSE_VALUE, "a\u0000b");
		const fields = readFields(buf);
		assert.equal(fields.body, "ab");
	});

	test("rejects oversized single packet", () => {
		const big = "x".repeat(RCON_MAX_BODY_BYTES + 1);
		assert.throws(() => encodePacket(1, SERVERDATA_RESPONSE_VALUE, big));
	});
});

describe("encodeResponseValuePackets", () => {
	test("splits body across packets under 4096 bytes", () => {
		const body = "y".repeat(RCON_MAX_BODY_BYTES + 100);
		const packets = encodeResponseValuePackets(5, body);
		assert.equal(packets.length, 2);
		for (const packet of packets) {
			assert.ok(packet.length <= RCON_MAX_PACKET_BYTES);
			assert.equal(packet.readInt32LE(8), SERVERDATA_RESPONSE_VALUE);
			assert.equal(packet.readInt32LE(4), 5);
		}
		const joined = packets
			.map((packet) => {
				const decoded = decodePacket(packet);
				assert.equal(decoded.ok, true);
				return decoded.ok ? decoded.packet.body : "";
			})
			.join("");
		assert.equal(joined, body);
	});

	test("strips null bytes before splitting", () => {
		const packets = encodeResponseValuePackets(1, "ok\u0000tail");
		assert.equal(packets.length, 1);
		const decoded = decodePacket(packets[0]!);
		assert.equal(decoded.ok, true);
		if (decoded.ok) {
			assert.equal(decoded.packet.body, "oktail");
		}
	});
});

describe("decodePacket", () => {
	test("round-trips encoded packets", () => {
		const original = encodePacket(3, SERVERDATA_AUTH, "pw");
		const decoded = decodePacket(original);
		assert.equal(decoded.ok, true);
		if (decoded.ok) {
			assert.deepEqual(decoded.packet, {
				id: 3,
				type: SERVERDATA_AUTH,
				body: "pw",
			});
			assert.equal(decoded.bytesRead, original.length);
		}
	});

	test("truncated buffer is incomplete, not success", () => {
		const full = encodePacket(1, SERVERDATA_AUTH, "password");
		const partial = full.subarray(0, full.length - 3);
		const decoded = decodePacket(partial);
		assert.deepEqual(decoded, { ok: false, reason: "incomplete" });
	});

	test("rejects size field larger than available bytes", () => {
		const buf = Buffer.alloc(8);
		buf.writeInt32LE(100, 0);
		buf.writeInt32LE(1, 4);
		const decoded = decodePacket(buf);
		assert.deepEqual(decoded, { ok: false, reason: "incomplete" });
	});

	test("rejects size mismatch and missing terminators", () => {
		const bad = Buffer.alloc(20);
		bad.writeInt32LE(16, 0);
		bad.writeInt32LE(1, 4);
		bad.writeInt32LE(SERVERDATA_AUTH, 8);
		bad.write("no-double-null", 12);
		assert.equal(decodePacket(bad).ok, false);

		const oversize = Buffer.alloc(4);
		oversize.writeInt32LE(RCON_MAX_SIZE_FIELD + 1, 0);
		assert.deepEqual(decodePacket(oversize), { ok: false, reason: "invalid" });
	});

	test("decodePackets handles two packets in one buffer", () => {
		const first = encodePacket(1, SERVERDATA_AUTH, "a");
		const second = encodePacket(2, SERVERDATA_EXECCOMMAND, "help");
		const combined = Buffer.concat([first, second]);
		const { packets, rest } = decodePackets(combined);
		assert.equal(packets.length, 2);
		assert.equal(packets[0]!.type, SERVERDATA_AUTH);
		assert.equal(packets[1]!.body, "help");
		assert.equal(rest.length, 0);
	});

	test("decodePackets leaves remainder when truncated", () => {
		const full = encodePacket(9, SERVERDATA_AUTH, "secret");
		const splitAt = full.length - 2;
		const { packets, rest } = decodePackets(full.subarray(0, splitAt));
		assert.equal(packets.length, 0);
		assert.equal(rest.length, splitAt);
	});
});

describe("stripNullBytes", () => {
	test("removes all null code units", () => {
		assert.equal(stripNullBytes("a\u0000\u0000b"), "ab");
	});
});
