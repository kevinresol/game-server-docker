import { getGameToolEntryPoint, shell } from "@/common";
import { HandlerInput } from "@why-ts/cli";

type Args = {
	game: string;
};
export default async function ({
	args: { game, "--": rest },
	logger,
}: HandlerInput<Args>) {
	await shell("ts-node", [getGameToolEntryPoint(game), ...rest]);
}
