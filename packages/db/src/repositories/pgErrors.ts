/** Postgres の一意制約違反か（drizzle は元のエラーを cause に入れる）。エラーの番号を知るのはリポジトリだけにする。 */
export function isUniqueViolation(err: unknown): boolean {
    const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
    return (e?.code ?? e?.cause?.code) === '23505';
}
