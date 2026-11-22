/**
 * ワールドを公開する（作者の署名付きで出す）ときに要るもの。下書き・署名の無い保存には求めない。
 * エディタ・CLI・backend が同じ規則で確かめる。読む側（部屋・ほかのサーバー）は、足す前に公開されたワールドも読む。
 */

/** サムネイルはワールドの一覧とポータル（core:portal）に出す。 */
export const WORLD_THUMBNAIL_REQUIRED = '公開するには、サムネイルを決めてください（ワールドの一覧とポータルに出ます）';

/** 公開できない理由（無ければ null）。 */
export function worldPublishProblem(spec: { thumbnail?: string | null }): string | null {
    return spec.thumbnail?.trim() ? null : WORLD_THUMBNAIL_REQUIRED;
}
