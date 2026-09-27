import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * 他サーバーの作者アカウント（handle@domain）と署名公開鍵の、確認済みの結び付け。
 * 初回（claim）だけ WebFinger で確認して保存し、以後の通常アクセス・ワールド読み込みはこれを使う
 * （毎回ネットワークに出ない）。署名の鍵がこれと違うとき（鍵の入れ替え等）だけ確認し直して更新する。
 * 自サーバーのアカウントは users を直接見るのでここには入れない。
 */
export const authorBindings = pgTable('author_bindings', {
    account: text('account').primaryKey(),
    publicKey: text('public_key').notNull(),
    /** 確認時点の表示名（通常アクセスではこれを表示し、古くなったら裏で更新する）。 */
    displayName: text('display_name'),
    confirmedAt: timestamp('confirmed_at').defaultNow().notNull(),
    refreshedAt: timestamp('refreshed_at').defaultNow().notNull(),
});
