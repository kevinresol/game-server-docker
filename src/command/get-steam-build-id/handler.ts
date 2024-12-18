import { HandlerInput } from "@why-ts/cli";
import { delay } from "@why-ts/core";
import { match } from "ts-pattern";
import { z } from "zod";

type Args = {
	appId: number;
	branch: string;
};

export default async function ({
	args: { appId, branch },
	logger,
}: HandlerInput<Args>) {
	logger.error(`Getting Steam build ID for app=${appId}, branch=${branch}...`);
	const data = await getSteamBuildId({ appId, branch });
	logger.log(JSON.stringify(data));
}

export async function getSteamBuildId({ appId, branch }: Args) {
	const MAX_ATTEMPTS = 10;
	async function query(
		attempt = 1
	): Promise<{ buildId: string; timeUpdated: Date }> {
		if (attempt === MAX_ATTEMPTS) {
			throw new Error("Failed to query SteamCmd API");
		}

		const res = await fetch(
			new URL(`/v1/info/${appId}`, "https://api.steamcmd.net")
		);

		return match(makeSteamCmdSchema(appId).parse(await res.json()))
			.with({ status: "failed" }, async () => {
				await delay(Math.min(120, 2 ** attempt) * 1000);
				return query(attempt + 1);
			})
			.with({ status: "success" }, ({ data }) => {
				const { buildid, timeupdated } = data[appId].depots.branches[branch];
				return {
					buildId: buildid,
					timeUpdated: new Date(Number(timeupdated) * 1000),
				};
			})
			.exhaustive();
	}

	return await query();
}

function makeSteamCmdSchema(appId: number) {
	return z.discriminatedUnion("status", [
		z.object({ status: z.literal("failed") }),
		z.object({
			status: z.literal("success"),
			data: z.record(
				z.literal(appId.toString()),
				z.object({
					depots: z.object({
						branches: z.record(
							z.object({
								buildid: z.string(),
								pwsrequired: z.literal("1").optional(),
								timeupdated: z.string(),
							})
						),
					}),
				})
			),
		}),
	]);
}
