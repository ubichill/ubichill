'use client';

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
    joinRoom: (name: string, roomId?: string, instanceId?: string) => void;
    updatePosition: (position: CursorPosition) => void;
    updateStatus: (status: UserStatus) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

/**
 * ソケット接続を子コンポーネントに提供するプロバイダー
 */
export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const socketRef = useRef<AppSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [users, setUsers] = useState<Map<string, User>>(new Map());
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Initialize socket connection
        const socketUrl = process.env.NODE_ENV === 'production' ? undefined : SERVER_CONFIG.DEV_URL;

        const socket: AppSocket = io(socketUrl || window.location.origin, {
            autoConnect: false,
            path: '/socket.io',
        });

        socketRef.current = socket;

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
            setError(msg);
        });

        // Connect to server
        socket.connect();

        // Cleanup on unmount
        return () => {
            socket.disconnect();
        };
    }, []);

    const joinRoom = useCallback((name: string, roomId: string = DEFAULTS.ROOM_ID, instanceId?: string) => {
        const socket = socketRef.current;
        if (!socket) return;

        const initialUser: Omit<User, 'id'> = {
            name,
            status: DEFAULTS.USER_STATUS,
            position: DEFAULTS.INITIAL_POSITION,
            lastActiveAt: Date.now(),
        };

        socket.emit('room:join', { roomId, instanceId, user: initialUser }, (response) => {
            if (response.success && response.userId) {
                setCurrentUser({ ...initialUser, id: response.userId });
            } else {
                setError(response.error || 'Failed to join room');
            }
        });
    }, []);

    const updatePosition = useCallback(
        (position: CursorPosition) => {
            const socket = socketRef.current;
            if (!socket || !isConnected) return;

            socket.emit('cursor:move', position);

            if (currentUser) {
                setCurrentUser({ ...currentUser, position });
            }
        },
        [isConnected, currentUser],
    );

    const updateStatus = useCallback(
        (status: UserStatus) => {
            const socket = socketRef.current;
            if (!socket || !isConnected) return;

            socket.emit('status:update', status);

            if (currentUser) {
                setCurrentUser({ ...currentUser, status });
            }
        },
        [isConnected, currentUser],
    );

    const value: SocketContextValue = {
        socket: socketRef.current,
        isConnected,
        users,
        currentUser,
        error,
        joinRoom,
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
