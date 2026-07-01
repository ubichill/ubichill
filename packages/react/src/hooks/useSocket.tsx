import {
    type ClientToServerEvents,
    type CursorPosition,
    DEFAULTS,
    SERVER_CONFIG,
    type ServerToClientEvents,
    type User,
    type UserStatus,
} from '@ubichill/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

// Socket type definition
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface SocketContextValue {
    socket: AppSocket | null;
    isConnected: boolean;
    users: Map<string, User>;
    currentUser: User | null;
    error: string | null;
    joinWorld: (name: string, worldId: string, instanceId: string, onError?: (error: string) => void) => void;
    leaveWorld: () => Promise<void>;
    updatePosition: (position: CursorPosition, heldEntityId?: string | null) => void;
    updateStatus: (status: UserStatus) => void;
    updateUser: (patch: Partial<User>) => void;
}

export const SocketContext = createContext<SocketContextValue | null>(null);

/**
 * ソケット接続を子コンポーネントに提供するプロバイダー
 */
export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const socketRef = useRef<AppSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [users, setUsers] = useState<Map<string, User>>(new Map());
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const currentUserRef = useRef<User | null>(null);
    const [error, setError] = useState<string | null>(null);
    const isInitializedRef = useRef(false);

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

        // Dev サーバー検出: 開発時は frontend (5173 等) と backend (3001) が別ポート。
        // 本番は同 origin で配信されるので socketUrl は undefined にして同 origin を使う。
        const isDev =
            typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
            window.location.port !== '' &&
            window.location.port !== '3001';
        const socketUrl = isDev ? SERVER_CONFIG.DEV_URL : undefined;

        const socket: AppSocket = io(socketUrl || window.location.origin, {
            autoConnect: false,
            path: '/socket.io',
            withCredentials: true,
        });

        socketRef.current = socket;
        isInitializedRef.current = true;

        // Set up event listeners
        socket.on('connect', () => {
            setIsConnected(true);
            setError(null);
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

        socket.on('cursor:moved', ({ userId, position, heldEntityId }) => {
            setUsers((prev) => {
                const user = prev.get(userId);
                if (!user) return prev;

                // 位置情報を更新
                const newMap = new Map(prev);
                newMap.set(userId, {
                    ...user,
                    position,
                    ...(heldEntityId !== undefined && { heldEntityId }),
                });
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

        socket.on('user:updated', (updatedUser) => {
            setUsers((prev) => {
                const newMap = new Map(prev);
                newMap.set(updatedUser.id, updatedUser);
                return newMap;
            });

            // 自分の情報が更新された場合はcurrentUserも更新
            const current = currentUserRef.current;
            if (current && current.id === updatedUser.id) {
                setCurrentUser(updatedUser);
            }
        });

        socket.on('error', (msg) => {
            // Ignore "最初にワールドに参加する必要があります" errors if we're not joined
            if (msg === '最初にワールドに参加する必要があります' && !currentUserRef.current) {
                return;
            }
            setError(msg);
        });

        return socket;
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, []);

    const joinWorld = useCallback(
        (name: string, worldId: string, instanceId: string, onError?: (error: string) => void) => {
            // ソケットを初期化して接続
            const socket = initializeSocket();

            const initialUser: Omit<User, 'id'> = {
                name,
                status: DEFAULTS.USER_STATUS,
                position: DEFAULTS.INITIAL_POSITION,
                lastActiveAt: Date.now(),
            };

            // 接続後にワールドに参加
            const emitJoin = () => {
                setError(null);
                socket.emit('world:join', { worldId, instanceId, user: initialUser }, (response) => {
                    if (response.success && response.userId) {
                        const newUser = { ...initialUser, id: response.userId };
                        setCurrentUser(newUser);
                        currentUserRef.current = newUser;
                    } else {
                        const msg = response.error || 'Failed to join world';
                        setError(msg);
                        onError?.(msg);
                    }
                });
            };

            if (socket.connected) {
                emitJoin();
            } else {
                socket.once('connect', emitJoin);
                socket.connect();
            }
        },
        [initializeSocket],
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
            const updated = {
                ...current,
                position,
                ...(heldEntityId !== undefined && { heldEntityId }),
            };
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

    const updateUser = useCallback(
        (patch: Partial<User>) => {
            const socket = socketRef.current;
            const current = currentUserRef.current;
            if (!socket || !isConnected || !current) return;

            socket.emit('user:update', patch);

            // 楽観的更新はせず、サーバーからの user:updated イベントを待つ
            // (サーバー側でのバリデーションや正規化を反映するため)
        },
        [isConnected],
    );

    const leaveWorld = useCallback(() => {
        return new Promise<void>((resolve) => {
            const socket = socketRef.current;
            if (!socket || !isConnected) {
                resolve();
                return;
            }

            let isDone = false;
            const cleanupAndResolve = () => {
                if (isDone) return;
                isDone = true;
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
        socket: socketRef.current,
        isConnected,
        users,
        currentUser,
        error,
        joinWorld,
        leaveWorld,
        updatePosition,
        updateStatus,
        updateUser,
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
