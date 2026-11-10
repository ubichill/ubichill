import type { Instance } from '@ubichill/shared';

export { localWorldPagePath, worldPagePath } from '@ubichill/shared';

/**
 * インスタンスのワールドを指す URL（お気に入り・新しいインスタンス作成のキー）。
 * 外部ワールドは id だけでは自サーバーで解決できないので、取得元の URL を優先する。
 */
export function instanceWorldRef(world: Pick<Instance['world'], 'id' | 'source'>): string {
    return world.source?.url ?? world.id;
}

/**
 * 一覧から来たワールドに短い共有ページ（`/@handle/name`）があるか、問い合わせる必要があるか。
 * 一覧の項目には付いていないので外部のワールドは問い合わせる。ただし作者を確かめられないと分かっている
 * （署名なし・作者なし）ものは付かないので省く。確認の結果を持たない項目（一部の一覧）は問い合わせる。
 */
export function needsSharePathLookup(world: {
    url?: string;
    source?: { kind: string };
    sharePath?: string;
    identity?: { status: string; author?: string };
}): world is { url: string } {
    const authorUnknowable = !!world.identity && !(world.identity.status === 'verified' && world.identity.author);
    return !world.sharePath && !!world.url && world.source?.kind !== 'local' && !authorUnknowable;
}
