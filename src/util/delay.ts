export default function delay(ms: number): Promise<void>;
export default function delay<T>(ms: number, get: () => T): Promise<T>;
export default function delay<T>(ms: number, get?: () => T): Promise<T> {
	return new Promise((resolve) => setTimeout(() => resolve(get?.() as T), ms));
}
