import path from "node:path";

export const SETTING_XML_NAME = "setting.xml";

export type SecretReadFailureReason =
	| "missing_file"
	| "missing_secret"
	| "empty_secret"
	| "duplicate_secret"
	| "wrong_root"
	| "decode_error"
	| "settingspath_missing_token";

export type SecretReadResult =
	| { ok: true; secret: string }
	| { ok: false; reason: SecretReadFailureReason };

export type ReadFileFn = (filePath: string) => string | undefined;

export type SettingPathResult =
	| { ok: true; path: string }
	| { ok: false; reason: "settingspath_missing_token" };

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

const ROOT_OPEN_RE = /^<(?:[\w.-]+:)?SettingData(\s[^>]*)?>/;
const ROOT_CLOSE_RE = /^<\/(?:[\w.-]+:)?SettingData>/;
const SECRET_OPEN_RE = /^<(?:[\w.-]+:)?ServerAuthSecret(\s[^>]*)?(\/?)>/;
const SECRET_CLOSE_RE = /^<\/(?:[\w.-]+:)?ServerAuthSecret>/;

export function resolveSettingXmlPath(
	installDir: string,
	gameArgs: readonly string[],
): SettingPathResult {
	for (let i = 0; i < gameArgs.length; i++) {
		if (gameArgs[i] !== "-settingspath") continue;
		const token = gameArgs[i + 1];
		if (token === undefined) {
			return { ok: false, reason: "settingspath_missing_token" };
		}
		return { ok: true, path: token };
	}
	return { ok: true, path: path.join(installDir, SETTING_XML_NAME) };
}

export function readServerAuthSecret(
	installDir: string,
	gameArgs: readonly string[],
	readFile: ReadFileFn,
): SecretReadResult {
	const resolved = resolveSettingXmlPath(installDir, gameArgs);
	if (!resolved.ok) {
		return { ok: false, reason: resolved.reason };
	}

	const content = readFile(resolved.path);
	if (content === undefined) {
		return { ok: false, reason: "missing_file" };
	}

	return parseSettingXml(content);
}

function parseSettingXml(content: string): SecretReadResult {
	const inner = extractSettingDataInner(content);
	if (inner === null) {
		return { ok: false, reason: "wrong_root" };
	}

	const rawSecrets = collectServerAuthSecretText(inner);
	if (rawSecrets.length === 0) {
		return { ok: false, reason: "missing_secret" };
	}
	if (rawSecrets.length > 1) {
		return { ok: false, reason: "duplicate_secret" };
	}

	const raw = rawSecrets[0]!;
	const decoded = decodeXmlText(raw);
	if (decoded === null) {
		return { ok: false, reason: "decode_error" };
	}
	if (decoded.length === 0) {
		return { ok: false, reason: "empty_secret" };
	}

	return { ok: true, secret: decoded };
}

function stripXmlComments(xml: string): string {
	let result = "";
	let i = 0;
	while (i < xml.length) {
		if (xml.startsWith("<!--", i)) {
			const end = xml.indexOf("-->", i + 4);
			if (end === -1) {
				result += xml.slice(i);
				break;
			}
			i = end + 3;
			continue;
		}
		result += xml[i];
		i++;
	}
	return result;
}

function skipLeadingMarkup(xml: string): number {
	let i = 0;
	while (i < xml.length) {
		const ch = xml[i]!;
		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			i++;
			continue;
		}
		if (xml.startsWith("<?", i)) {
			const end = xml.indexOf("?>", i);
			if (end === -1) return i;
			i = end + 2;
			continue;
		}
		break;
	}
	return i;
}

function firstElementName(xml: string, start: number): string | null {
	if (xml[start] !== "<") return null;
	if (xml.startsWith("<!--", start) || xml.startsWith("<?", start)) return null;
	const match = /^<([^\s/>]+)/.exec(xml.slice(start));
	return match?.[1] ?? null;
}

function isSettingDataTag(name: string): boolean {
	return /^(?:[\w.-]+:)?SettingData$/.test(name);
}

function extractSettingDataInner(content: string): string | null {
	const withoutComments = stripXmlComments(content);
	const start = skipLeadingMarkup(withoutComments);
	const firstName = firstElementName(withoutComments, start);
	if (firstName === null || !isSettingDataTag(firstName)) {
		return null;
	}

	const openMatch = ROOT_OPEN_RE.exec(withoutComments.slice(start));
	if (!openMatch) return null;

	let i = start + openMatch[0].length;
	if (openMatch[0].endsWith("/>")) {
		return "";
	}

	let depth = 1;
	while (i < withoutComments.length && depth > 0) {
		if (withoutComments[i] !== "<") {
			i++;
			continue;
		}
		if (withoutComments.startsWith("<!--", i)) {
			const end = withoutComments.indexOf("-->", i + 4);
			if (end === -1) return null;
			i = end + 3;
			continue;
		}
		if (withoutComments.startsWith("<?", i)) {
			const end = withoutComments.indexOf("?>", i);
			if (end === -1) return null;
			i = end + 2;
			continue;
		}

		const closeSetting = ROOT_CLOSE_RE.exec(withoutComments.slice(i));
		if (closeSetting && closeSetting.index === 0) {
			depth--;
			if (depth === 0) {
				return withoutComments.slice(start + openMatch[0].length, i);
			}
			i += closeSetting[0].length;
			continue;
		}

		const nestedOpen = /^<(?:[\w.-]+:)?SettingData(\s[^>]*)?(\/?)>/.exec(
			withoutComments.slice(i),
		);
		if (nestedOpen && nestedOpen.index === 0 && !nestedOpen[0].endsWith("/>")) {
			depth++;
			i += nestedOpen[0].length;
			continue;
		}

		i++;
	}

	return null;
}

function collectServerAuthSecretText(inner: string): string[] {
	const withoutComments = stripXmlComments(inner);
	const secrets: string[] = [];
	let i = 0;

	while (i < withoutComments.length) {
		const openMatch = SECRET_OPEN_RE.exec(withoutComments.slice(i));
		if (!openMatch || openMatch.index !== 0) {
			i++;
			continue;
		}

		const fullOpen = openMatch[0];
		const selfClosing = openMatch[2] === "/";
		i += fullOpen.length;

		if (selfClosing) {
			secrets.push("");
			continue;
		}

		let text = "";
		while (i < withoutComments.length) {
			const closeMatch = SECRET_CLOSE_RE.exec(withoutComments.slice(i));
			if (closeMatch && closeMatch.index === 0) {
				secrets.push(text);
				i += closeMatch[0].length;
				break;
			}
			text += withoutComments[i];
			i++;
		}
	}

	return secrets;
}

function isValidCodePoint(code: number): boolean {
	return (
		Number.isInteger(code) &&
		code >= 0 &&
		code <= 0x10ffff &&
		!(code >= 0xd800 && code <= 0xdfff)
	);
}

function decodeXmlText(text: string): string | null {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (ch !== "&") {
			out += ch;
			continue;
		}

		const semi = text.indexOf(";", i + 1);
		if (semi === -1) return null;

		const ref = text.slice(i + 1, semi);
		let replacement: string | null = null;

		if (ref.startsWith("#x") || ref.startsWith("#X")) {
			const hex = ref.slice(2);
			if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
			const code = Number.parseInt(hex, 16);
			if (!isValidCodePoint(code)) return null;
			replacement = String.fromCodePoint(code);
		} else if (ref.startsWith("#")) {
			const dec = ref.slice(1);
			if (!/^[0-9]+$/.test(dec)) return null;
			const code = Number.parseInt(dec, 10);
			if (!isValidCodePoint(code)) return null;
			replacement = String.fromCodePoint(code);
		} else {
			replacement = NAMED_ENTITIES[ref] ?? null;
			if (replacement === null) return null;
		}

		out += replacement;
		i = semi;
	}
	return out;
}
