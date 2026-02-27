import type { WorldDefinition } from '@ubichill/shared';
import { relations } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import { userFavorites, users } from './users';

export const worlds = pgTable('worlds', {
    id: varchar('id', { length: 21 })
        .$defaultFn(() => nanoid())
        .primaryKey(),
    authorId: text('author_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    version: varchar('version', { length: 50 }).notNull(),
    definition: jsonb('definition').$type<WorldDefinition>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const worldsRelations = relations(worlds, ({ one, many }) => ({
    author: one(users, {
        fields: [worlds.authorId],
        references: [users.id],
    }),
    favoritedBy: many(userFavorites),
}));
