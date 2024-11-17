import { getAllGames, getGamePath, shell } from "@/common";
import { HandlerInput, UsageError } from "@why-ts/cli";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { match } from "ts-pattern";
import { z } from "zod";
import { buildGameTool } from "../build-game-tool/handler";
import { listDockerTags } from "../list-docker-tags/handler";
import { listSteamBranches } from "../list-steam-branches/handler";

const DOCKER_NAMESPACE = process.env.DOCKER_NAMESPACE ?? "kevinresol";

type Args = {
	game?: string;
	all?: boolean;
	force?: boolean;
};

export default async function ({
	args: { game, all, force },
}: HandlerInput<Args>) {
	if (all) {
		for (const game of await getAllGames()) {
			await build(game, force);
		}
	} else if (game) {
		await build(game, force);
	} else {
		throw new UsageError(
			"RUNTIME_ERROR",
			"Please specify a game or use --all to build all games."
		);
	}
}

async function build(game: string, force?: boolean) {
	const info = INFO_SCHEMA.parse(
		JSON.parse(await readFile(getGamePath(game, "info.json"), "utf-8"))
	);

	const repository = `${DOCKER_NAMESPACE}/${game}-dedicated-server`;
	const pushedTags = await listDockerTags({ repository });

	await match(info)
		.with({ kind: "steam" }, async ({ appId, ignoreBranches = [] }) => {
			const branches = Object.entries(await listSteamBranches({ appId }))
				.filter(
					([branch, { passwordRequired }]) =>
						!passwordRequired && !ignoreBranches.includes(branch)
				)
				// sort image so that latest image is built first
				.sort(
					(a, b) => b[1].timeUpdated.getTime() - a[1].timeUpdated.getTime()
				);

			for (const [branch, { timeUpdated }] of branches) {
				const desiredTags = [
					sanitizeTag(branch),
					...(branch === "public" ? ["latest"] : []), // also tag the public branch as latest
				];

				const shouldBuild =
					force ||
					desiredTags.some(
						(desired) =>
							match(pushedTags.find(({ name }) => name === desired))
								.with(undefined, () => true) // if the tag is not already pushed, we should build
								.otherwise((v) => v.lastUpdated < timeUpdated) // if the tag is pushed but outdated, we should build
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

function sanitizeTag(tag: string) {
	return tag.replace(/[^a-zA-Z0-9.-]/g, "_");
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

	// remove image after push
	await shell("docker", ["rmi", ...images]);
}

const INFO_SCHEMA = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("steam"),
		appId: z.number(),
		ignoreBranches: z.array(z.string()).optional(),
	}),
]);
