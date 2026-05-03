export function hashString(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

export function pushLimitedCache<T>(
	cache: Map<string, T>,
	limit: number,
	key: string,
	value: T,
): T {
	cache.set(key, value);
	if (cache.size <= limit) return value;
	const firstKey = cache.keys().next().value;
	if (typeof firstKey === "string") cache.delete(firstKey);
	return value;
}
