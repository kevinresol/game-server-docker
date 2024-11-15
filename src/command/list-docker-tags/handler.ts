import { HandlerInput } from "@why-ts/cli";
import { match, P } from "ts-pattern";

export const DEFAULT_REGISTRY = "https://hub.docker.com";

type Args = {
	repository: string;
	registry?: string;
};

export default async function ({
	args: { repository, registry },
	logger,
}: HandlerInput<Args>) {
	logger.error(`Listing tags for "${repository}"...`);
	const tags = await listDockerTags({ repository, registry });
	logger.log(JSON.stringify(tags));
}

export async function listDockerTags({
	repository,
	registry = DEFAULT_REGISTRY,
}: Omit<Args, "format">) {
	const [ns, repo] = match(repository.split("/"))
		.with([P.string], ([name]) => ["library", name] as const)
		.with([P.string, P.string], (v) => v)
		.otherwise(() => {
			throw new Error("Invalid repository format");
		});

	return match(
		await queryDockerApi<{ name: string; last_updated: string }>(
			new URL(
				`/v2/namespaces/${ns}/repositories/${repo}/tags?page_size=100`,
				registry
			)
		)
	)
		.with({ success: false, code: 404 }, () => []) // 404 means the repository does not exist
		.with({ success: true }, ({ data }) =>
			data.map((tag) => ({
				name: tag.name,
				lastUpdated: new Date(tag.last_updated),
			}))
		)
		.otherwise(({ error }) => {
			throw new Error(`Failed to query docker API: ${error}`);
		});
}

async function queryDockerApi<T>(url: URL): Promise<QueryResult<T[]>> {
	const results: T[] = [];

	while (true) {
		console.error(`Querying ${url}...`);
		const res = await fetch(url);

		if (res.status !== 200) {
			return { success: false, code: res.status, error: await res.json() };
		}

		const json = (await res.json()) as DockerApiResponse<T>;

		results.push(...json.results);

		if (!json.next) break;

		url = new URL(json.next);
	}

	return { success: true, data: results };
}

type QueryResult<T> =
	| { success: true; data: T }
	| { success: false; code: number; error: unknown };

type DockerApiResponse<T> = {
	count: number;
	next?: string;
	previous?: string;
	results: Array<T>;
};

// wget -q -O - "https://hub.docker.com/v2/namespaces/library/repositories/debian/tags?page_size=100" | grep -o '"name": *"[^"]*' | grep -o '[^"]*$'
