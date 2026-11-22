import { z } from 'zod';

/**
 * ワールドの公開範囲（ubichill のサーバーに置いたワールドだけが持つ。署名した中身には入れない）。
 * - `public`: だれでもインスタンスを作れ、ワールドに置くポータルの行き先にできる
 * - `private`: インスタンスを作れるのは作者だけ（作者のサーバーで）。ポータルの行き先にできない。作者が作った部屋には
 *   URL や部屋へのポータルで入れる。ほかのサーバーへはファイルのヘッダー（WORLD_VISIBILITY_HEADER）で知らせる
 * ほかの外部・同梱のワールドは持たない（パブリックとして扱う）。規則は world/worldVisibility.ts。
 */
export const WORLD_VISIBILITIES = ['private', 'public'] as const;
export const WorldVisibilitySchema = z.enum(WORLD_VISIBILITIES);
export type WorldVisibility = z.infer<typeof WorldVisibilitySchema>;
