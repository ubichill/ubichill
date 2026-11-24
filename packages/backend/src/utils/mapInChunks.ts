/** concurrency 件ずつ順に処理する（外への取得を一度に集中させない）。結果は items と同じ順。 */
export async function mapInChunks<T, U>(
    items: readonly T[],
    fn: (item: T) => Promise<U>,
    concurrency: number,
): Promise<U[]> {
    const chunks = Array.from({ length: Math.ceil(items.length / concurrency) }, (_, i) =>
        items.slice(i * concurrency, (i + 1) * concurrency),
    );
    return chunks.reduce<Promise<U[]>>(
        async (prev, chunk) => [...(await prev), ...(await Promise.all(chunk.map(fn)))],
        Promise.resolve([]),
    );
}
