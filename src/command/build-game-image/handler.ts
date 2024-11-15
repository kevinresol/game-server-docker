import { getAllGames, getGamePath, shell } from "@/common";
import { HandlerInput, UsageError } from "@why-ts/cli";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { match } from "ts-pattern";
import { z } from "zod";
import { getSteamBuildId } from "../get-steam-build-id/handler";
import { listDockerTags } from "../list-docker-tags/handler";
import { buildGameTool } from "../build-game-tool/handler";

const DOCKER_NAMESPACE = process.env.DOCKER_NAMESPACE ?? "kevinresol";

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
			await build(game);
		}
	} else if (game) {
		await build(game);
	} else {
		throw new UsageError(
			"RUNTIME_ERROR",
			"Please specify a game or use --all to build all games."
		);
	}
}

async function build(game: string) {
	const info = INFO_SCHEMA.parse(
		JSON.parse(await readFile(getGamePath(game, "info.json"), "utf-8"))
	);

	const repository = `${DOCKER_NAMESPACE}/${game}-dedicated-server`;
	const pushedTags = await listDockerTags({ repository });

	await match(info)
		.with({ kind: "steam" }, async ({ appId, branches }) => {
			for (const [branch, { aliases = [] }] of Object.entries(branches)) {
				const data = await getSteamBuildId({ appId, branch });

				const desiredTags = [branch, ...aliases];
				const shouldBuild = desiredTags.some(
					(desired) =>
						match(pushedTags.find(({ name }) => name === desired))
							.with(undefined, () => true) // if the tag is not already pushed, we should build
							.otherwise(({ lastUpdated }) => lastUpdated < data.timeUpdated) // if the tag is pushed but outdated, we should build
				);

				if (shouldBuild) {
					await buildGameTool(game);

					await buildAndPushImage({
						dockerfile: path.join("./games", game, "Dockerfile"),
						context: path.join("./games", game),
						repository,
						tags: desiredTags,
						args: { BRANCH: branch },
					});
				}
			}
		})
		.exhaustive();
}

async function buildAndPushImage(args: {
	dockerfile: string;
	context: string;
	repository: string;
	args: Record<string, string>;
	tags: string[];
}) {
	const images = args.tags.map((tag) => `${args.repository}:${tag}`);

	await shell("docker", [
		"build",
		"--platform=linux/amd64",
		`--push`,
		...images.map((image) => `--tag=${image}`),
		...Object.entries(args.args).map(
			([key, value]) => `--build-arg=${key}=${value}`
		),
		`--file=${args.dockerfile}`,
		args.context,
	]);
}

const INFO_SCHEMA = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("steam"),
		appId: z.number(),
		branches: z.record(z.object({ aliases: z.string().array().optional() })),
	}),
]);
