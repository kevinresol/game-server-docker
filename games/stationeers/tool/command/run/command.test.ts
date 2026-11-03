import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { InvalidArgsError } from "@why-ts/cli";
import {
	RCON_DEFAULT_PORT,
	parseRunArgsForTest,
	validateRconOptionValue,
} from "./command";

const BASE = ["--bin-path=/opt/game", "--data-path=/data"];

describe("validateRconOptionValue", () => {
	test("accepts empty string for bare --rcon", () => {
		assert.equal(validateRconOptionValue(""), true);
	});

	test("accepts valid ports", () => {
		assert.equal(validateRconOptionValue(String(RCON_DEFAULT_PORT)), true);
		assert.equal(validateRconOptionValue("27015"), true);
	});

	test("rejects invalid ports", () => {
		assert.match(String(validateRconOptionValue("0")), /1 through 65535/);
		assert.match(String(validateRconOptionValue("99999")), /between 1 and 65535/);
		assert.match(String(validateRconOptionValue("abc")), /1 through 65535/);
		assert.match(String(validateRconOptionValue("01")), /1 through 65535/);
	});
});

describe("run command --rcon parsing", () => {
	test("absent leaves rcon undefined", async () => {
		const args = await parseRunArgsForTest([...BASE, "--", "-file"]);
		assert.equal(args.rcon, undefined);
	});

	test("bare --rcon is an empty string", async () => {
		const args = await parseRunArgsForTest([...BASE, "--rcon", "--", "-file"]);
		assert.equal(args.rcon, "");
	});

	test("accepts explicit ports", async () => {
		assert.equal(
			(await parseRunArgsForTest([...BASE, `--rcon=${RCON_DEFAULT_PORT}`, "--"])).rcon,
			String(RCON_DEFAULT_PORT),
		);
		assert.equal(
			(await parseRunArgsForTest([...BASE, "--rcon=27015", "--"])).rcon,
			"27015",
		);
	});

	test("invalid values fail before the handler runs", async () => {
		for (const port of ["0", "99999", "abc", "01"]) {
			await assert.rejects(
				() => parseRunArgsForTest([...BASE, `--rcon=${port}`, "--"]),
				(err: unknown) => {
					assert.ok(err instanceof InvalidArgsError);
					return true;
				},
			);
		}
	});
});
