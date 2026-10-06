import { type CursorPosition, DEFAULTS, type User, type UserStatus } from '@ubichill/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { InstanceSocket, type ResolveInstance } from '../lib/instanceSocket';

export type JoinWorld = (name: string, instanceId: string, onError?: (error: string) => void) => void;

export interface SocketContextValue {
    socket: InstanceSocket | null;
    isConnected: boolean;
    users: Map<string, User>;
    currentUser: User | null;
    error: string | null;
    joinWorld: JoinWorld;
    leaveWorld: () => Promise<void>;
    updatePosition: (position: CursorPosition, heldEntityId?: string | null) => void;
    updateStatus: (status: UserStatus) => void;
}

export const SocketContext = createContext<SocketContextValue | null>(null);

/**
 * ソケット接続を子コンポーネントに提供するプロバイダー
 */
export const SocketProvider: React.FC<{ children: React.ReactNode; resolveInstance: ResolveInstance }> = ({
    children,
    resolveInstance,
}) => {
    const socketRef = useRef<InstanceSocket | null>(null);
    const [activeSocket, setActiveSocket] = useState<InstanceSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [users, setUsers] = useState<Map<string, User>>(new Map());
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const currentUserRef = useRef<User | null>(null);
    const [error, setError] = useState<string | null>(null);
    const isInitializedRef = useRef(false);

    /**
     * world:join を送る。再接続時の参加し直しは InstanceSocket が行い、その結果もここへ返る。
     * 失敗したら参加していない状態に戻す（画面は理由を出してロビーへ戻せる）。
     */
    const sendJoin = useCallback(
        (socket: InstanceSocket, instanceId: string, user: Omit<User, 'id'>, onError?: (error: string) => void) => {
            setError(null);
            socket.emit('world:join', { instanceId, user }, (response) => {
                if (response.success && response.userId) {
                    const newUser = { ...user, id: response.userId };
                    setCurrentUser(newUser);
                    currentUserRef.current = newUser;
                } else {
                    const msg = response.error || 'Failed to join world';
                    setCurrentUser(null);
                    currentUserRef.current = null;
                    setError(msg);
                    onError?.(msg);
                }
            });
        },
        [],
    );

    // Keep ref in sync
    useEffect(() => {
        currentUserRef.current = currentUser;
    }, [currentUser]);

    /**
     * ソケットを初期化（まだ接続しない）
     * joinWorld が呼ばれたときに接続する
     */
    const initializeSocket = useCallback(() => {
        if (isInitializedRef.current && socketRef.current) {
            return socketRef.current;
        }

        const socket = new InstanceSocket(resolveInstance);

        socketRef.current = socket;
        setActiveSocket(socket);
        isInitializedRef.current = true;

        // Set up event listeners
        socket.on('connect', () => {
            setIsConnected(true);
            setError(null);
        });

        socket.on('session:replaced', () => {
            setCurrentUser(null);
            currentUserRef.current = null;
            setError('同じアカウントが別のタブ・端末でインスタンスに参加したため、こちらの接続は切れました');
        });

        socket.on('instance:closing', (reason) => {
            setCurrentUser(null);
            currentUserRef.current = null;
            setError(reason);
        });

        socket.on('disconnect', () => {
            setIsConnected(false);
        });

        socket.on('connect_error', (err) => {
            setError(`Connection error: ${err.message}`);
            setIsConnected(false);

            // ここでは強制リダイレクトしない。dev のクロスオリジン構成では
            // バックエンド再起動などの一過性エラーが Unauthorized として届くことがあり、
            // それで /auth に飛ばすと「勝手にログアウト」に見える。
            // 認証の真偽判定は useSession / ProtectedRoute に一本化し、
            // socket は自動再接続に任せる（セッションが本当に切れていれば
            // ProtectedRoute が画面遷移し、その際に socket もクリーンアップされる）。
        });

        socket.on('users:update', (updatedUsers) => {
            const userMap = new Map<string, User>();
            updatedUsers.forEach((u) => {
                userMap.set(u.id, u);
            });
            setUsers(userMap);
        });

        socket.on('user:joined', (user) => {
            setUsers((prev) => {
                const newMap = new Map(prev);
                newMap.set(user.id, user);
                return newMap;
            });
        });

        socket.on('user:left', (userId) => {
            setUsers((prev) => {
                const newMap = new Map(prev);
                newMap.delete(userId);
                return newMap;
            });
        });

        socket.on('cursor:moved', ({ userId, position }) => {
            setUsers((prev) => {
                const user = prev.get(userId);
                if (!user) return prev;

                // 位置情報を更新
                const newMap = new Map(prev);
                newMap.set(userId, { ...user, position });
                return newMap;
            });
        });

        socket.on('status:changed', ({ userId, status }) => {
            setUsers((prev) => {
                const user = prev.get(userId);
                if (!user) return prev;
                const newMap = new Map(prev);
                newMap.set(userId, { ...user, status });
                return newMap;
            });
        });

        socket.on('error', (msg) => {
            // Ignore "最初にワールドに参加する必要があります" errors if we're not joined
            if (msg === '最初にワールドに参加する必要があります' && !currentUserRef.current) {
                return;
            }
            setError(msg);
        });

        return socket;
    }, [resolveInstance]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
                isInitializedRef.current = false;
            }
        };
    }, []);

    const joinWorld: JoinWorld = useCallback(
        (name, instanceId, onError) => {
            const initialUser: Omit<User, 'id'> = {
                name,
                status: DEFAULTS.USER_STATUS,
                position: DEFAULTS.INITIAL_POSITION,
                lastActiveAt: Date.now(),
            };
            sendJoin(initializeSocket(), instanceId, initialUser, onError);
        },
        [initializeSocket, sendJoin],
    );

    const updatePosition = useCallback(
        (position: CursorPosition, heldEntityId?: string | null) => {
            const socket = socketRef.current;
            const current = currentUserRef.current;
            if (!socket || !isConnected || !current) return;

            socket.emit('cursor:move', {
                position,
                ...(heldEntityId !== undefined && { heldEntityId }),
            });

            // ローカルの currentUser も更新
            const updated = { ...current, position };
            setCurrentUser(updated);
            currentUserRef.current = updated;
        },
        [isConnected],
    );

    const updateStatus = useCallback(
        (status: UserStatus) => {
            const socket = socketRef.current;
            const current = currentUserRef.current;
            if (!socket || !isConnected || !current) return;

            socket.emit('status:update', status);

            const updated = { ...current, status };
            setCurrentUser(updated);
            currentUserRef.current = updated;
        },
        [isConnected],
    );

    const leaveWorld = useCallback(() => {
        return new Promise<void>((resolve) => {
            const socket = socketRef.current;
            setUsers(new Map());
            setCurrentUser(null);
            currentUserRef.current = null;
            if (!socket || !isConnected) {
                socket?.disconnect();
                resolve();
                return;
            }

            let isDone = false;
            const cleanupAndResolve = () => {
                if (isDone) return;
                isDone = true;
                socket.disconnect();
                setIsConnected(false);
                resolve();
            };

            // ローカルステートは同期的にクリアして、直後のマウス移動などによるイベント送信を防ぐ
            setUsers(new Map());
            setCurrentUser(null);
            currentUserRef.current = null;
            setError(null);

            const timer = setTimeout(cleanupAndResolve, 3000);

            socket.emit('world:leave', () => {
                clearTimeout(timer);
                cleanupAndResolve();
            });
        });
    }, [isConnected]);

    const value: SocketContextValue = {
        socket: activeSocket,
        isConnected,
        users,
        currentUser,
        error,
        joinWorld,
        leaveWorld,
        updatePosition,
        updateStatus,
    };

    return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

/**
 * ソケット接続を利用するフック
 */
export const useSocket = (): SocketContextValue => {
    const context = useContext(SocketContext);
    if (!context) {
        throw new Error('useSocket must be used within a SocketProvider');
    }
    return context;
};
