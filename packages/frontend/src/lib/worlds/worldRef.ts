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

/**
 * 「編集」の行き先。このサーバーのワールドはそのまま編集する。外部（GitHub Pages など）に公開したワールドは、
 * 公開先へ書き戻せないので、コピーを新しいワールドとして開く（元のワールドは変わらない）。
 */
export function worldEditTarget(world: { id: string; source?: { kind: string; url: string } }): {
    copy: boolean;
    path: string;
} {
    if (!world.source || world.source.kind === 'local') {
        return { copy: false, path: `/world/${encodeURIComponent(world.id)}/edit` };
    }
    return { copy: true, path: `/worlds/new?from=${encodeURIComponent(world.source.url)}` };
}

/** 外部のワールドをコピーして編集する前の確認の文。 */
export function worldCopyConfirmText(sourceUrl: string): string {
    const host = URL.canParse(sourceUrl) ? new URL(sourceUrl).host : sourceUrl;
    return `このワールドは ${host} で公開されているので、ここでは書き換えられません。コピーを新しいワールドとして編集しますか？（元のワールドは変わりません）`;
}
