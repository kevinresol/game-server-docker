import { HandlerInput } from "@why-ts/cli";
import { delay } from "@why-ts/core";
import { match } from "ts-pattern";
import { z } from "zod";

type Args = {
	appId: number;
};

export default async function ({
	args: { appId },
	logger,
}: HandlerInput<Args>) {
	logger.error(`Listing Steam branches for app=${appId}...`);
	const data = await listSteamBranches({ appId, logger });
	logger.log(JSON.stringify(data));
}

export async function listSteamBranches({
	appId,
	maxAttempts = 10,
	logger,
}: {
	appId: number;
	maxAttempts?: number;
	logger: HandlerInput<Args>["logger"];
}) {
	async function query(
		attempt = 1
	): Promise<
		Record<
			string,
			{ buildId: string; timeUpdated: Date; passwordRequired: boolean }
		>
	> {
		if (attempt === maxAttempts) {
			throw new Error("Failed to query SteamCmd API");
		}

		const res = await fetch(
			new URL(`/v1/info/${appId}`, "https://api.steamcmd.net")
		);

		return match(makeSteamCmdSchema(appId).parse(await res.json()))
			.with({ status: "failed" }, async () => {
				const wait = Math.min(300, 2 ** attempt) * 1000;
				logger.error(
					`Failed to query SteamCmd API. Retrying in ${wait / 1000} seconds...`
				);
				await delay(wait);
				return query(attempt + 1);
			})
			.with({ status: "success" }, ({ data }) =>
				Object.fromEntries(
					Object.entries(data[appId].depots.branches).map(
						([branch, { buildid, timeupdated, pwdrequired }]) => [
							branch,
							{
								buildId: buildid,
								timeUpdated: new Date(Number(timeupdated) * 1000),
								passwordRequired: Boolean(pwdrequired),
							},
						]
					)
				)
			)
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
								pwdrequired: z.literal("1").optional(),
								timeupdated: z.string(),
							})
						),
					}),
				})
			),
		}),
	]);
}
