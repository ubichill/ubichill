import { describe, expect, it } from 'vitest';
import {
    assignedRolesOf,
    assignmentExpiryOf,
    compareRoles,
    isActiveAssignment,
    isAdministrator,
    publicRolesOf,
    ROLE_LIMITS,
    type RoleAssignmentFacts,
    RoleAssignmentRequestSchema,
    RoleColorSchema,
    type RoleFacts,
    RoleInputSchema,
    RoleNameSchema,
} from './roles';

const NOW = new Date('2026-11-10T00:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);

const role = (id: string, patch: Partial<RoleFacts> = {}): RoleFacts => ({
    id,
    name: id,
    color: '#123456',
    isPublic: true,
    isAdministrator: false,
    displayOrder: 0,
    ...patch,
});
const assigned = (r: RoleFacts, expiresAt: Date | null = null): RoleAssignmentFacts => ({ role: r, expiresAt });

const validInput = {
    name: 'スタッフ',
    description: '',
    color: '#AABBCC',
    isPublic: true,
    isAdministrator: false,
    displayOrder: 0,
};

describe('RoleInputSchema', () => {
    it('前後の空白を除き、色は小文字に、空の説明は null にそろえる', () => {
        expect(RoleInputSchema.parse({ ...validInput, name: '  スタッフ  ', description: '  ' })).toEqual({
            ...validInput,
            color: '#aabbcc',
            description: null,
        });
    });

    it('名前は空白だけ・改行入り・上限超えを受けない。上限ちょうど（絵文字はコードポイントで数える）は通す', () => {
        expect(RoleNameSchema.safeParse('   ').success).toBe(false);
        expect(RoleNameSchema.safeParse('a\nb').success).toBe(false);
        expect(RoleNameSchema.safeParse('a b').success).toBe(false);
        expect(RoleNameSchema.safeParse('あ'.repeat(ROLE_LIMITS.NAME_MAX + 1)).success).toBe(false);
        // サロゲートペアを 2 文字と数えない
        expect(RoleNameSchema.safeParse('\u{1F600}'.repeat(ROLE_LIMITS.NAME_MAX)).success).toBe(true);
    });

    it('説明は改行を許すが、ほかの制御文字と上限超えは受けない', () => {
        const parse = (description: string) => RoleInputSchema.safeParse({ ...validInput, description });
        expect(parse('1 行目\n2 行目\r\n3 行目').success).toBe(true);
        expect(parse('ベル\u0007').success).toBe(false);
        expect(parse('x'.repeat(ROLE_LIMITS.DESCRIPTION_MAX + 1)).success).toBe(false);
    });

    it('色は #rrggbb だけ（短い形・名前・アルファ付き・CSS の注入を受けない）', () => {
        for (const color of ['#abc', 'red', '#aabbccdd', 'aabbcc', '#gggggg', '#aabbcc;background:url(x)', '']) {
            expect(RoleColorSchema.safeParse(color).success, color).toBe(false);
        }
    });

    it('表示順は 0 以上の整数で上限まで。知らない項目（権限の付け足し）は受けない', () => {
        const parse = (patch: Record<string, unknown>) => RoleInputSchema.safeParse({ ...validInput, ...patch });
        expect(parse({ displayOrder: ROLE_LIMITS.DISPLAY_ORDER_MAX }).success).toBe(true);
        expect(parse({ displayOrder: ROLE_LIMITS.DISPLAY_ORDER_MAX + 1 }).success).toBe(false);
        expect(parse({ displayOrder: -1 }).success).toBe(false);
        expect(parse({ displayOrder: 1.5 }).success).toBe(false);
        expect(parse({ displayOrder: '1' }).success).toBe(false);
        expect(parse({ isModerator: true }).success).toBe(false);
        expect(parse({ isAdministrator: 'true' }).success).toBe(false);
    });
});

describe('アサインの期限', () => {
    it('無期限・未来は受け、いまちょうど・過去・日時でないものは受けない', () => {
        expect(assignmentExpiryOf(null, NOW)).toEqual({ ok: true, expiresAt: null });
        expect(assignmentExpiryOf(at(1).toISOString(), NOW)).toEqual({ ok: true, expiresAt: at(1) });
        expect(assignmentExpiryOf(NOW.toISOString(), NOW).ok).toBe(false);
        expect(assignmentExpiryOf(at(-1).toISOString(), NOW).ok).toBe(false);
        expect(assignmentExpiryOf('not a date', NOW).ok).toBe(false);
    });

    it('本文はタイムゾーン付きの ISO 8601 か null だけ', () => {
        expect(RoleAssignmentRequestSchema.safeParse({ expiresAt: '2026-12-01T09:00:00+09:00' }).success).toBe(true);
        expect(RoleAssignmentRequestSchema.safeParse({ expiresAt: null }).success).toBe(true);
        expect(RoleAssignmentRequestSchema.safeParse({ expiresAt: '2026-12-01' }).success).toBe(false);
        expect(RoleAssignmentRequestSchema.safeParse({ expiresAt: 1798761600000 }).success).toBe(false);
        expect(RoleAssignmentRequestSchema.safeParse({}).success).toBe(false);
    });

    it('期限の時刻ちょうどで切れる', () => {
        expect(isActiveAssignment({ expiresAt: at(1) }, NOW)).toBe(true);
        expect(isActiveAssignment({ expiresAt: NOW }, NOW)).toBe(false);
        expect(isActiveAssignment({ expiresAt: null }, NOW)).toBe(true);
    });
});

describe('isAdministrator', () => {
    const admin = role('admin', { isAdministrator: true, isPublic: false });

    it('公式アカウントはロールが無くても管理者（外せない）', () => {
        expect(isAdministrator('ubichill', [], NOW)).toBe(true);
        expect(isAdministrator('ubichill', [assigned(admin, at(-1))], NOW)).toBe(true);
    });

    it('管理者のロールを持っていれば管理者。期限が切れていれば管理者でない', () => {
        expect(isAdministrator('alice', [assigned(admin)], NOW)).toBe(true);
        expect(isAdministrator('alice', [assigned(admin, at(60_000))], NOW)).toBe(true);
        expect(isAdministrator('alice', [assigned(admin, NOW)], NOW)).toBe(false);
        expect(isAdministrator('alice', [assigned(admin, at(-1))], NOW)).toBe(false);
    });

    it('管理者でないロールをいくつ持っていても管理者でない。ID が似ているだけの人も管理者でない', () => {
        expect(isAdministrator('alice', [assigned(role('a')), assigned(role('b', { isPublic: false }))], NOW)).toBe(
            false,
        );
        for (const handle of ['Ubichill', 'ubichill ', 'ubichill@ubichill.com', '', undefined, null]) {
            expect(isAdministrator(handle, [], NOW), String(handle)).toBe(false);
        }
    });
});

describe('ロールの並びと公開', () => {
    it('表示順の大きい順。同じなら名前、さらに同じなら id で、毎回同じ並びになる', () => {
        const roles = [
            role('z', { displayOrder: 1 }),
            role('b', { name: 'same', displayOrder: 5 }),
            role('a', { name: 'same', displayOrder: 5 }),
            role('c', { name: 'alpha', displayOrder: 5 }),
        ];
        expect([...roles].sort(compareRoles).map((r) => r.id)).toEqual(['c', 'a', 'b', 'z']);
        expect(
            [...roles]
                .reverse()
                .sort(compareRoles)
                .map((r) => r.id),
        ).toEqual(['c', 'a', 'b', 'z']);
    });

    it('プロフィールには公開で期限の切れていないロールだけを、色と名前だけで出す', () => {
        const got = publicRolesOf(
            [
                assigned(role('hidden', { isPublic: false, displayOrder: 9 })),
                assigned(role('expired', { displayOrder: 8 }), at(-1)),
                assigned(role('low', { displayOrder: 1 })),
                assigned(role('high', { displayOrder: 7, isAdministrator: true }), at(1000)),
            ],
            NOW,
        );
        expect(got).toEqual([
            { id: 'high', name: 'high', color: '#123456' },
            { id: 'low', name: 'low', color: '#123456' },
        ]);
        // 管理者かどうか・期限は公開しない
        expect(Object.keys(got[0] ?? {})).toEqual(['id', 'name', 'color']);
    });

    it('コントロールパネルには非公開のロールも期限付きで出す（切れたものは出さない）', () => {
        expect(
            assignedRolesOf(
                [assigned(role('hidden', { isPublic: false }), at(1000)), assigned(role('expired'), at(-1))],
                NOW,
            ),
        ).toEqual([
            {
                id: 'hidden',
                name: 'hidden',
                color: '#123456',
                isPublic: false,
                isAdministrator: false,
                expiresAt: at(1000).toISOString(),
            },
        ]);
    });

    it('渡した配列を並べ替えない', () => {
        const input = [assigned(role('a', { displayOrder: 1 })), assigned(role('b', { displayOrder: 2 }))];
        publicRolesOf(input, NOW);
        expect(input.map((a) => a.role.id)).toEqual(['a', 'b']);
    });
});
