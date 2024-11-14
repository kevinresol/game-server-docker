import { HandlerInput } from "@why-ts/cli";
import { match, P } from "ts-pattern";

export const DEFAULT_REGISTRY = "https://hub.docker.com";
export const DEFAULT_FORMAT = "json" as const;

type Args = {
	repository: string;
	registry?: string;
	format?: "json" | "csv";
};

export default async function ({
	args: { repository, registry = DEFAULT_REGISTRY, format = DEFAULT_FORMAT },
	logger,
}: HandlerInput<Args>) {
	logger.error(`Listing tags for "${repository}"...`);

	const repo = match(repository.split("/"))
		.with([P.string], ([name]) => ["library", name])
		.with([P.string, P.string], (v) => v)
		.otherwise(() => {
			throw new Error("Invalid repository format");
		});

	const res = await queryDockerApi<{ name: string }>(
		new URL(
			`/v2/namespaces/${repo[0]}/repositories/${repo[1]}/tags?page_size=100`,
			registry
		)
	);

	logger.log(getFormatter(format)(res.map((tag) => tag.name)));
}

function getFormatter(format: "json" | "csv") {
	return match(format)
		.with("csv", () => (v: string[]) => v.join(","))
		.with("json", () => (v: string[]) => JSON.stringify(v))
		.exhaustive();
}

async function queryDockerApi<T>(url: URL): Promise<T[]> {
	const results: T[] = [];

	while (true) {
		console.error(`Querying ${url}...`);
		const res = await fetch(url);

		if (res.status !== 200) {
			throw new Error(
				`Failed to query ${url}: ${res.status} ${await res.text()}`
			);
		}

		const json = (await res.json()) as DockerApiResponse<T>;

		results.push(...json.results);

		if (!json.next) break;

		url = new URL(json.next);
	}

	return results;
}

type DockerApiResponse<T> = {
	count: number;
	next?: string;
	previous?: string;
	results: Array<T>;
};

// wget -q -O - "https://hub.docker.com/v2/namespaces/library/repositories/debian/tags?page_size=100" | grep -o '"name": *"[^"]*' | grep -o '[^"]*$'
