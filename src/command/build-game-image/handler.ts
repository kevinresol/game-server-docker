import { getAllGames, getGamePath, isCI, shell } from "@/common";
import { HandlerInput, UsageError } from "@why-ts/cli";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { match } from "ts-pattern";
import { z } from "zod";
import { buildGameTool } from "../build-game-tool/handler";
import { listDockerTags } from "../list-docker-tags/handler";
import { listSteamBranches } from "../list-steam-branches/handler";

type Args = {
	game?: string;
	all?: boolean;
	force?: boolean;
	push?: boolean;
	namespace: string;
};

export default async function ({
	args: { game, all, force, namespace, push },
	logger,
}: HandlerInput<Args>) {
	if (all) {
		for (const game of await getAllGames()) {
			await build({ game, force, namespace, push, logger });
		}
	} else if (game) {
		await build({ game, force, namespace, push, logger });
	} else {
		throw new UsageError(
			"RUNTIME_ERROR",
			"Please specify a game or use --all to build all games."
		);
	}
}

async function build({
	game,
	force,
	push,
	namespace,
	logger,
}: {
	game: string;
	force?: boolean;
	push?: boolean;
	namespace: string;
	logger: HandlerInput<Args>["logger"];
}) {
	const info = INFO_SCHEMA.parse(
		JSON.parse(await readFile(getGamePath(game, "info.json"), "utf-8"))
	);

	const repository = `${namespace}/${game}-dedicated-server`;
	const pushedTags = await listDockerTags({ repository });

	const getBranchStatus = (
		branch: string,
		timeUpdated: Date
	): { tags: string[]; shouldBuild: boolean } => {
		const tags = [
			sanitizeTag(branch),
			...(branch === "public" ? ["latest"] : []), // also tag the public branch as latest
		];
		const shouldBuild =
			force ||
			tags.some(
				(desired) =>
					match(pushedTags.find(({ name }) => name === desired))
						.with(undefined, () => true) // if the tag is not already pushed, we should build
						.otherwise((v) => v.lastUpdated < timeUpdated) // if the tag is pushed but outdated, we should build
			);
		return { tags, shouldBuild };
	};

	await match(info)
		.with({ kind: "steam" }, async ({ appId, ignoreBranches = [] }) => {
			console.log(`== Listing Steam branches for app=${appId}...`);
			const branches = Object.entries(
				await listSteamBranches({ appId }, logger)
			)
				.filter(
					([branch, { passwordRequired }]) =>
						!passwordRequired && !ignoreBranches.includes(branch)
				)
				// sort image so that "public" is always first, then by timeUpdated
				.sort(([b1, { timeUpdated: t1 }], [b2, { timeUpdated: t2 }]) =>
					b1 === "public"
						? -1
						: b2 === "public"
						? 1
						: t2.getTime() - t1.getTime()
				)
				.map(([branch, { timeUpdated }]) => ({
					branch,
					...getBranchStatus(branch, timeUpdated),
				}));

			console.log(`== Found branches:`);
			branches.forEach(({ branch, tags, shouldBuild }) =>
				console.log(
					`   - Steam: ${branch} => Docker: ${tags.join(", ")} (${
						shouldBuild ? "Build" : "Skip"
					})`
				)
			);

			for (const { branch, tags } of branches.filter((b) => b.shouldBuild)) {
				console.log(`== Building ${game}: ${tags.join(", ")}`);
				await buildGameTool(game);

				await buildAndPushImage({
					dockerfile: getGamePath(game, "Dockerfile"),
					context: getGamePath(game),
					repository,
					tags,
					args: { BRANCH: branch },
					push,
				});
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
	push?: boolean;
}) {
	const images = args.tags.map((tag) => `${args.repository}:${tag}`);

	console.log(`== Building images: ${images.join(", ")}`);
	// await shell("df", ["-h"]);
	await shell("docker", [
		"build",
		"--platform=linux/amd64",
		...(args.push ? ["--push"] : []),
		...images.map((image) => `--tag=${image}`),
		...Object.entries(args.args).map(
			([key, value]) => `--build-arg=${key}=${value}`
		),
		`--file=${args.dockerfile}`,
		args.context,
	]);

	// clean up after push
	console.log(`== Cleaning up builder cache`);
	if (isCI) {
		await shell("docker", ["rmi", ...images]);
		await shell("docker", ["builder", "prune", "-af"]);
	}
}

const INFO_SCHEMA = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("steam"),
		appId: z.number(),
		ignoreBranches: z.array(z.string()).optional(),
	}),
]);
