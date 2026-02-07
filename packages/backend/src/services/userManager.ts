import type { CursorPosition, CursorState, User, UserStatus } from '@ubichill/shared';

/**
 * ユーザー管理サービス
 * ルームベースのフィルタリングでユーザー状態を管理
 */
export class UserManager {
    private users: Map<string, User> = new Map();
    private userRooms: Map<string, string> = new Map(); // userId -> roomId

    addUser(userId: string, roomId: string, user: User): void {
        this.users.set(userId, user);
        this.userRooms.set(userId, roomId);
    }

    removeUser(userId: string): User | undefined {
        const user = this.users.get(userId);
        this.users.delete(userId);
        this.userRooms.delete(userId);
        return user;
    }

    getUser(userId: string): User | undefined {
        return this.users.get(userId);
    }

    /**
     * 特定のルーム内の全ユーザーを取得
     */
    getUsersByRoom(roomId: string): User[] {
        const roomUsers: User[] = [];

        for (const [userId, userRoomId] of this.userRooms.entries()) {
            if (userRoomId === roomId) {
                const user = this.users.get(userId);
                if (user) {
                    roomUsers.push(user);
                }
            }
        }

        return roomUsers;
    }

    /**
     * ユーザーのルームIDを取得
     */
    getUserRoom(userId: string): string | undefined {
        return this.userRooms.get(userId);
    }

    /**
     * ユーザーのカーソル位置を更新
     */
    updateUserPosition(userId: string, position: CursorPosition, state?: CursorState): boolean {
        const user = this.users.get(userId);
        if (!user) return false;

        user.position = position;
        if (state !== undefined) {
            user.cursorState = state;
        }
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

        if ('avatar' in patch && patch.avatar !== undefined) {
            safePatch.avatar = patch.avatar;
        }
        if ('cursorState' in patch && patch.cursorState !== undefined) {
            safePatch.cursorState = patch.cursorState;
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
     * ルーム総数を取得
     */
    getRoomCount(): number {
        return new Set(this.userRooms.values()).size;
    }
}

// シングルトンインスタンスをエクスポート
export const userManager = new UserManager();
