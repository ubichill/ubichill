import type { Instance } from '@ubichill/shared';

/**
 * インスタンスのワールドを指す URL（お気に入り・新しいインスタンス作成のキー）。
 * 外部ワールドは id だけでは自サーバーで解決できないので、取得元の URL を優先する。
 */
export function instanceWorldRef(world: Pick<Instance['world'], 'id' | 'source'>): string {
    return world.source?.url ?? world.id;
}

/**
 * このサーバーのワールドの共有ページのパス（`/@handle/name`）。正規 URL（`.../api/v1/authors/:handle/worlds/:name.yaml`）から作り、
 * API のオリジンとフロントのオリジンが違っても（開発環境）フロントのパスにする。作れなければ以前の形（`/world/:id`）。
 */
export function localWorldPagePath(world: { id: string; url?: string }): string {
    const author = world.url ? /\/api\/v1\/authors\/([^/]+)\/worlds\/([^/?#.]+)\.yaml$/.exec(world.url) : null;
    return author ? `/@${author[1]}/${author[2]}` : `/world/${encodeURIComponent(world.id)}`;
}

/**
 * ワールドの共有ページのパス（このサーバーの中）。短い共有ページ（`/@handle/name`）があればそれ、本体のワールドは正規 URL から、
 * それ以外の外部のワールドは `/world?url=…`（作者を確かめられていなくても開ける）。
 */
export function worldPagePath(world: {
    id: string;
    url?: string;
    source?: { kind: string };
    sharePath?: string;
}): string {
    if (world.sharePath) return world.sharePath;
    if (world.source?.kind === 'local' || !world.url) return localWorldPagePath(world);
    return `/world?url=${encodeURIComponent(world.url)}`;
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
