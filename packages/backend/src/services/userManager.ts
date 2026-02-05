import type { CursorPosition, User, UserStatus } from '@ubichill/shared';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

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

        // DBにユーザーを永続化（非同期で実行し、メインフローをブロックしない）
        this.saveUserToDb(user).catch((err) => {
            logger.error(`Failed to save user to DB: ${err.message}`);
        });
    }

    private async saveUserToDb(user: User): Promise<void> {
        try {
            // 名前で検索して既存ユーザーがあれば更新、なければ作成
            // 注意: 現状は認証がないため、同名の別人も同じユーザーとして扱われる可能性がある
            // 本来はCookie/TokenなどでPersistent IDを管理すべき
            await prisma.user.create({
                data: {
                    name: user.name,
                    // 将来的には avatarUrl なども
                },
            });
            logger.debug(`User saved to DB: ${user.name}`);
        } catch (error) {
            logger.error('Error saving user to DB:', error);
            throw error;
        }
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
