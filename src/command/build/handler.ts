import { HandlerInput, UsageError } from "@why-ts/cli";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { match } from "ts-pattern";
import { z } from "zod";
import { getSteamBuildId } from "../get-steam-build-id/handler";
import { listDockerTags } from "../list-docker-tags/handler";

type Args = {
	game?: string;
	all?: boolean;
};
export default async function ({
	args: { game, all },
	logger,
}: HandlerInput<Args>) {
	if (all) {
		for (const game of await getAllGames()) {
			await buildGame(game);
		}
	} else if (game) {
		await buildGame(game);
	} else {
		throw new UsageError(
			"RUNTIME_ERROR",
			"Please specify a game or use --all to build all games."
		);
	}
}

async function buildGame(game: string) {
	const info = INFO_SCHEMA.parse(
		JSON.parse(await readFile(path.join("./games", game, "info.json"), "utf-8"))
	);

	const tags = await listDockerTags({
		repository: `kevinresol/${game}-dedicated-server`,
	});

	await match(info)
		.with({ kind: "steam" }, async ({ appId, branches }) => {
			for (const [branch, { aliases }] of Object.entries(branches)) {
				const data = await getSteamBuildId({ appId, branch });

				const shouldBuild = !tags.some((v) => v.name === branch);

				if (shouldBuild) {
					// TODO: build iamge
				}
			}
		})
		.exhaustive();
}

async function getAllGames(): Promise<string[]> {
	const items = await readdir("./games");
	const isDir = await Promise.all(
		items.map(async (v) => {
			const s = await stat(path.join("./games/", v));
			return s.isDirectory();
		})
	);
	return items.filter((_, i) => isDir[i]);
}

const INFO_SCHEMA = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("steam"),
		appId: z.number(),
		branches: z.record(z.object({ aliases: z.string().array().optional() })),
	}),
]);
