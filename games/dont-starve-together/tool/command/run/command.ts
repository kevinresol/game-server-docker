import { option as o } from "@why-ts/cli";
import baseCommand from "../common";
import handler from "./handler";

export default baseCommand
	.meta({ description: "Run the game." })
	.handle(handler);
