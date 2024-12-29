import { HandlerInput, UsageError } from "@why-ts/cli";
import * as esbuild from "esbuild";
import path from "node:path";
import * as pkg from "pkg";
import {
	getAllGames,
	getGameToolEntryPoint,
	getGameToolOutput,
} from "@/common";

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
			await buildGameTool(game);
		}
	} else if (game) {
		await buildGameTool(game);
	} else {
		throw new UsageError(
			"RUNTIME_ERROR",
			"Please specify a game or use --all to build all games."
		);
	}
}

export async function buildGameTool(game: string) {
	console.log(`Building game tool: ${game}`);

	const outputJs = getGameToolOutput(game);
	const outputFolder = path.dirname(outputJs);

	// bundle the ts files
	await esbuild.build({
		entryPoints: [getGameToolEntryPoint(game)],
		outfile: outputJs,
		bundle: true,
		minify: true,
		platform: "node",
		format: "cjs",
	});

	// bundle the nodejs runtime
	// await pkg.exec([
	// 	outputJs,
	// 	"--targets=node18-linux-x64",
	// 	`--out-path=${outputFolder}`,
	// ]);
}
