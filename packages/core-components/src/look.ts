import { z } from 'zod';

/**
 * 押せる部品（入口・ワープ・スイッチ）の見た目。standard は部品が自分で描く。none は何も描かず、Entity の矩形いっぱいを
 * 押せる場所にする（見た目は同じ Entity の画像・文字で付ける）。
 */
export const PART_LOOKS = ['standard', 'none'] as const;

export type PartLook = (typeof PART_LOOKS)[number];

// 見た目だけの項目なので、知らない値（新しい版で足した値・書き誤り）は断らずに標準として読む。
// 断ると部品の data ごと読めなくなり、押せない部品になる
export const PartLookSchema = z.enum(PART_LOOKS).default('standard').catch('standard');
