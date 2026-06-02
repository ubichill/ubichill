import type { CursorPosition, User, UserStatus } from '@ubichill/shared';

/**
 * ユーザー管理サービス
 * ワールドベースのフィルタリングでユーザー状態を管理
 */
export class UserManager {
    private users: Map<string, User> = new Map();
    private userWorlds: Map<string, string> = new Map(); // userId -> worldId
    private worldUsers: Map<string, Set<string>> = new Map(); // worldId -> Set<userId>

    addUser(userId: string, worldId: string, user: User): void {
        this.users.set(userId, user);
        this.userWorlds.set(userId, worldId);

        let usersInWorld = this.worldUsers.get(worldId);
        if (!usersInWorld) {
            usersInWorld = new Set();
            this.worldUsers.set(worldId, usersInWorld);
        }
        usersInWorld.add(userId);
    }

    removeUser(userId: string): User | undefined {
        const user = this.users.get(userId);
        const worldId = this.userWorlds.get(userId);

        this.users.delete(userId);
        this.userWorlds.delete(userId);

        if (worldId) {
            const usersInWorld = this.worldUsers.get(worldId);
            if (usersInWorld) {
                usersInWorld.delete(userId);
                if (usersInWorld.size === 0) {
                    this.worldUsers.delete(worldId);
                }
            }
        }

        return user;
    }

    getUser(userId: string): User | undefined {
        return this.users.get(userId);
    }

    /**
     * 特定のワールド内の全ユーザーを取得
     */
    getUsersByWorld(worldId: string): User[] {
        const worldUsers: User[] = [];
        const userIds = this.worldUsers.get(worldId);

        if (userIds) {
            for (const userId of userIds) {
                const user = this.users.get(userId);
                if (user) {
                    worldUsers.push(user);
                }
            }
        }

        return worldUsers;
    }

    /**
     * ユーザーのワールドIDを取得
     */
    getUserWorld(userId: string): string | undefined {
        return this.userWorlds.get(userId);
    }

    /**
     * ユーザーのカーソル位置を更新
     */
    updateUserPosition(userId: string, position: CursorPosition): boolean {
        const user = this.users.get(userId);
        if (!user) return false;

        user.position = position;
        user.lastActiveAt = Date.now();
        return true;
    }

    /**
     * ユーザーのステータスを更新
     */
    updateUserStatus(userId: string, status: UserStatus): boolean {
        const user = this.users.get(userId);
        if (!user) return false;

        user.status = status;
        user.lastActiveAt = Date.now();
        return true;
    }

    /**
     * ユーザー情報を更新（汎用）
     */
    updateUser(userId: string, patch: Partial<User>): User | null {
        const user = this.users.get(userId);
        if (!user) return null;

        // 更新を許可するフィールドのみをホワイトリストで抽出
        const safePatch: Partial<User> = {};

        // penColor: ペンプラグインが設定・解除する（null も許可）
        if ('penColor' in patch) {
            safePatch.penColor = patch.penColor ?? null;
        }
        // heldEntityId: Ubi.grip が hold/release 時に更新する（null も許可）
        if ('heldEntityId' in patch) {
            safePatch.heldEntityId = patch.heldEntityId ?? null;
        }

        // オブジェクトを更新
        const updatedUser = {
            ...user,
            ...safePatch,
            lastActiveAt: Date.now(),
        };

        this.users.set(userId, updatedUser);
        return updatedUser;
    }

    /**
     * ユーザー総数を取得
     */
    getUserCount(): number {
        return this.users.size;
    }

    /**
     * ワールド総数を取得
     */
    getWorldCount(): number {
        return this.worldUsers.size;
    }
}

// シングルトンインスタンスをエクスポート
export const userManager = new UserManager();
