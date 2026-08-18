import type { ComponentInstance } from '@ubichill/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// entityHandlers.ts は ../utils/logger 経由で ../config (DATABASE_URL 等の必須環境変数を
// 検証する) を読み込む。ハンドラのロジックだけをテストしたいのでロガーをモックし、
// テスト実行環境に本物の env を用意しなくても済むようにする。
vi.mock('../utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { clearInstanceState, createEntity, getEntity } from '../services/instanceState';
import type { TypedSocket } from './_shared';
import { handleEntityCreate, handleEntityDelete, handleEntityPatch } from './entityHandlers';

const INSTANCE_ID = 'instance-1';

/** テスト用の最小 socket モック。emit / to().emit / data のみ使う。 */
function makeSocket(userId: string): TypedSocket {
    const emitted: unknown[] = [];
    return {
        data: { instanceId: INSTANCE_ID, userId, authUser: { id: userId, email: '', name: '', image: null } },
        emit: vi.fn((...args: unknown[]) => emitted.push(args)),
        to: vi.fn(() => ({ emit: vi.fn() })),
        // biome-ignore lint/suspicious/noExplicitAny: テスト用の最小モック
    } as any as TypedSocket;
}

function baseEntity(): Omit<ComponentInstance, 'id'> {
    return {
        type: 'test:test',
        ownerId: null,
        lockedBy: null,
        transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
        data: {},
    };
}

describe('entityHandlers 認可', () => {
    beforeEach(() => {
        clearInstanceState(INSTANCE_ID);
    });

    describe('handleEntityCreate', () => {
        it('client が ownerId を偽装しても、サーバーが認証済み userId で上書きする', () => {
            const socket = makeSocket('user-a');
            const callback = vi.fn();
            handleEntityCreate(socket)({ ...baseEntity(), ownerId: 'user-b' }, callback);

            expect(callback).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, entity: expect.objectContaining({ ownerId: 'user-a' }) }),
            );
        });
    });

    describe('handleEntityPatch', () => {
        it('他ユーザーが lock 中のエンティティは更新を拒否する', () => {
            const owner = makeSocket('user-a');
            const callback = vi.fn();
            handleEntityCreate(owner)({ ...baseEntity(), id: 'e1', lockedBy: 'user-a' } as never, callback);
            const entity = (callback.mock.calls[0]?.[0] as { entity: ComponentInstance }).entity;

            const attacker = makeSocket('user-b');
            handleEntityPatch(attacker)({
                entityId: entity.id,
                patch: { transform: { x: 999, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 } },
            });

            expect(attacker.emit).toHaveBeenCalledWith('error', expect.stringContaining('操作中'));
            expect(getEntity(INSTANCE_ID, entity.id)?.transform.x).toBe(0);
        });

        it('ownerId を patch に含めても無視される（不変）', () => {
            const entity = createEntity(INSTANCE_ID, { ...baseEntity(), ownerId: 'user-a' });
            const socket = makeSocket('user-a');

            handleEntityPatch(socket)({ entityId: entity.id, patch: { ownerId: 'user-b' } as never });

            expect(getEntity(INSTANCE_ID, entity.id)?.ownerId).toBe('user-a');
        });

        it('lockedBy は自分自身としてしか取得できない（他人へのなりすまし禁止）', () => {
            const entity = createEntity(INSTANCE_ID, baseEntity());
            const socket = makeSocket('user-a');

            handleEntityPatch(socket)({ entityId: entity.id, patch: { lockedBy: 'user-b' } });

            expect(getEntity(INSTANCE_ID, entity.id)?.lockedBy).toBe('user-a');
        });

        it('lockedBy を null にして解放できる', () => {
            const entity = createEntity(INSTANCE_ID, { ...baseEntity(), lockedBy: 'user-a' });
            const socket = makeSocket('user-a');

            handleEntityPatch(socket)({ entityId: entity.id, patch: { lockedBy: null } });

            expect(getEntity(INSTANCE_ID, entity.id)?.lockedBy).toBeNull();
        });
    });

    describe('handleEntityDelete', () => {
        it('他ユーザーが所有するエンティティの削除を拒否する', () => {
            const entity = createEntity(INSTANCE_ID, { ...baseEntity(), ownerId: 'user-a' });
            const attacker = makeSocket('user-b');

            handleEntityDelete(attacker)(entity.id);

            expect(attacker.emit).toHaveBeenCalledWith('error', expect.stringContaining('所有'));
            expect(getEntity(INSTANCE_ID, entity.id)).toBeDefined();
        });

        it('ownerId が null (mod が自律管理) のエンティティは誰でも削除できる', () => {
            const entity = createEntity(INSTANCE_ID, { ...baseEntity(), ownerId: null });
            const anyone = makeSocket('user-b');

            handleEntityDelete(anyone)(entity.id);

            expect(getEntity(INSTANCE_ID, entity.id)).toBeUndefined();
        });

        it('所有者本人は削除できる', () => {
            const entity = createEntity(INSTANCE_ID, { ...baseEntity(), ownerId: 'user-a' });
            const owner = makeSocket('user-a');

            handleEntityDelete(owner)(entity.id);

            expect(getEntity(INSTANCE_ID, entity.id)).toBeUndefined();
        });
    });
});
