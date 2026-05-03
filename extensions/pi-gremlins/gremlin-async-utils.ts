export async function mapWithConcurrency<T, U>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length));
	const results = new Array<U>(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await mapper(items[index], index);
		}
	}

	await Promise.all(Array.from({ length: limit }, () => worker()));
	return results;
}
