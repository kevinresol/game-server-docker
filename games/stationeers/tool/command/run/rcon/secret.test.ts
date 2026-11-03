import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
	readServerAuthSecret,
	resolveSettingXmlPath,
	SETTING_XML_NAME,
	type ReadFileFn,
} from "./secret";

const INSTALL = "/opt/stationeers";
const DEFAULT_PATH = path.join(INSTALL, SETTING_XML_NAME);

function xml(body: string): string {
	return `<?xml version="1.0" encoding="utf-8"?>\n<SettingData>${body}</SettingData>`;
}

function readFrom(map: Record<string, string>): ReadFileFn {
	return (filePath: string) => map[filePath];
}

describe("resolveSettingXmlPath", () => {
	test("defaults to install directory setting.xml", () => {
		const resolved = resolveSettingXmlPath(INSTALL, ["-file", "start"]);
		assert.deepEqual(resolved, { ok: true, path: DEFAULT_PATH });
	});

	test("B7 — -settingspath token is the file path unchanged", () => {
		const custom = "/data/custom/setting.xml";
		const resolved = resolveSettingXmlPath(INSTALL, ["-settingspath", custom, "-file"]);
		assert.deepEqual(resolved, { ok: true, path: custom });
	});

	test("B7b — -settingspath without a following token fails", () => {
		const resolved = resolveSettingXmlPath(INSTALL, ["-file", "-settingspath"]);
		assert.deepEqual(resolved, { ok: false, reason: "settingspath_missing_token" });
	});
});

describe("readServerAuthSecret", () => {
	test("multi-element fixture at install root", () => {
		const secret = "launch-secret-42";
		const contents = `<?xml version="1.0" encoding="utf-8"?>
<SettingData xmlns="http://example.com/settings">
  <!-- ServerAuthSecret is not the password -->
  <SavePath>/data/world</SavePath>
  <OtherSetting>ignored</OtherSetting>
  <ServerAuthSecret>${secret}</ServerAuthSecret>
</SettingData>`;
		const readPaths: string[] = [];
		const readFile: ReadFileFn = (filePath) => {
			readPaths.push(filePath);
			if (filePath === DEFAULT_PATH) return contents;
			return undefined;
		};

		const result = readServerAuthSecret(INSTALL, ["-file", "start"], readFile);
		assert.deepEqual(result, { ok: true, secret });
		assert.deepEqual(readPaths, [DEFAULT_PATH]);
	});

	test("B6 — launch-style secret with entity decoding", () => {
		const contents = xml(
			`<ServerAuthSecret>change-this&amp;secret&#65;&#x21;</ServerAuthSecret>`,
		);
		const result = readServerAuthSecret(
			INSTALL,
			[],
			readFrom({ [DEFAULT_PATH]: contents }),
		);
		assert.deepEqual(result, { ok: true, secret: "change-this&secretA!" });
	});

	test("does not trim secret text", () => {
		const contents = xml(`<ServerAuthSecret>  padded  </ServerAuthSecret>`);
		const result = readServerAuthSecret(
			INSTALL,
			[],
			readFrom({ [DEFAULT_PATH]: contents }),
		);
		assert.deepEqual(result, { ok: true, secret: "  padded  " });
	});

	test("B7 — reads -settingspath file, not install root", () => {
		const custom = "/mnt/settings/setting.xml";
		const installContents = xml(`<ServerAuthSecret>wrong</ServerAuthSecret>`);
		const customContents = xml(`<ServerAuthSecret>from-custom</ServerAuthSecret>`);
		const readPaths: string[] = [];
		const readFile: ReadFileFn = (filePath) => {
			readPaths.push(filePath);
			if (filePath === custom) return customContents;
			if (filePath === DEFAULT_PATH) return installContents;
			return undefined;
		};

		const result = readServerAuthSecret(
			INSTALL,
			["-settingspath", custom],
			readFile,
		);
		assert.deepEqual(result, { ok: true, secret: "from-custom" });
		assert.deepEqual(readPaths, [custom]);
	});

	test("B7b — missing -settingspath token does not read install root", () => {
		const readPaths: string[] = [];
		const readFile: ReadFileFn = (filePath) => {
			readPaths.push(filePath);
			return xml(`<ServerAuthSecret>x</ServerAuthSecret>`);
		};

		const result = readServerAuthSecret(INSTALL, ["-settingspath"], readFile);
		assert.deepEqual(result, { ok: false, reason: "settingspath_missing_token" });
		assert.deepEqual(readPaths, []);
	});

	test("missing file", () => {
		const result = readServerAuthSecret(INSTALL, [], () => undefined);
		assert.deepEqual(result, { ok: false, reason: "missing_file" });
	});

	test("missing ServerAuthSecret element", () => {
		const contents = xml(`<SavePath>/data</SavePath>`);
		const result = readServerAuthSecret(
			INSTALL,
			[],
			readFrom({ [DEFAULT_PATH]: contents }),
		);
		assert.deepEqual(result, { ok: false, reason: "missing_secret" });
	});

	test("empty ServerAuthSecret element", () => {
		const contents = xml(`<ServerAuthSecret></ServerAuthSecret>`);
		const result = readServerAuthSecret(
			INSTALL,
			[],
			readFrom({ [DEFAULT_PATH]: contents }),
		);
		assert.deepEqual(result, { ok: false, reason: "empty_secret" });
	});

	test("self-closing empty ServerAuthSecret", () => {
		const contents = xml(`<ServerAuthSecret/>`);
		const result = readServerAuthSecret(
			INSTALL,
			[],
			readFrom({ [DEFAULT_PATH]: contents }),
		);
		assert.deepEqual(result, { ok: false, reason: "empty_secret" });
	});

	test("duplicated ServerAuthSecret element", () => {
		const contents = xml(
			`<ServerAuthSecret>one</ServerAuthSecret><ServerAuthSecret>two</ServerAuthSecret>`,
		);
		const result = readServerAuthSecret(
			INSTALL,
			[],
			readFrom({ [DEFAULT_PATH]: contents }),
		);
		assert.deepEqual(result, { ok: false, reason: "duplicate_secret" });
	});

	test("wrong root element", () => {
		const contents = `<Settings><ServerAuthSecret>x</ServerAuthSecret></Settings>`;
		const result = readServerAuthSecret(
			INSTALL,
			[],
			readFrom({ [DEFAULT_PATH]: contents }),
		);
		assert.deepEqual(result, { ok: false, reason: "wrong_root" });
	});

	test("decode error on unknown entity", () => {
		const contents = xml(`<ServerAuthSecret>&unknown;</ServerAuthSecret>`);
		const result = readServerAuthSecret(
			INSTALL,
			[],
			readFrom({ [DEFAULT_PATH]: contents }),
		);
		assert.deepEqual(result, { ok: false, reason: "decode_error" });
	});

	test("each call reads the file again without caching", () => {
		let current = xml(`<ServerAuthSecret>first</ServerAuthSecret>`);
		const readFile: ReadFileFn = () => current;

		assert.deepEqual(readServerAuthSecret(INSTALL, [], readFile), {
			ok: true,
			secret: "first",
		});

		current = xml(`<ServerAuthSecret>second</ServerAuthSecret>`);
		assert.deepEqual(readServerAuthSecret(INSTALL, [], readFile), {
			ok: true,
			secret: "second",
		});

		current = `<SettingData></SettingData>`;
		assert.deepEqual(readServerAuthSecret(INSTALL, [], readFile), {
			ok: false,
			reason: "missing_secret",
		});
	});

	test("reads real file from disk via fs", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stn-r3-"));
		const file = path.join(dir, SETTING_XML_NAME);
		fs.writeFileSync(file, xml(`<ServerAuthSecret>disk-secret</ServerAuthSecret>`));
		try {
			const readFile: ReadFileFn = (filePath) => {
				try {
					return fs.readFileSync(filePath, "utf8");
				} catch {
					return undefined;
				}
			};
			const result = readServerAuthSecret(dir, [], readFile);
			assert.deepEqual(result, { ok: true, secret: "disk-secret" });
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
