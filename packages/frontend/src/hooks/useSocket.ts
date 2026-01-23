import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
    ClientToServerEvents,
    ServerToClientEvents,
    User,
    UserStatus,
    CursorPosition,
    SERVER_CONFIG,
    DEFAULTS
} from '@ubichill/shared';

// Socket type definition
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const useSocket = () => {
    const socketRef = useRef<AppSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [users, setUsers] = useState<User[]>([]);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Initialize socket connection
        const socket: AppSocket = io(SERVER_CONFIG.DEV_URL, {
            autoConnect: false,
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
            setUsers(updatedUsers);
        });

        socket.on('user:joined', (user) => {
            setUsers(prev => [...prev, user]);
        });

        socket.on('user:left', (userId) => {
            setUsers(prev => prev.filter(u => u.id !== userId));
        });

        socket.on('cursor:moved', ({ userId, position }) => {
            setUsers(prev => prev.map(u =>
                u.id === userId ? { ...u, position } : u
            ));
        });

        socket.on('status:changed', ({ userId, status }) => {
            setUsers(prev => prev.map(u =>
                u.id === userId ? { ...u, status } : u
            ));
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

    const joinRoom = useCallback((name: string, roomId: string = DEFAULTS.ROOM_ID) => {
        const socket = socketRef.current;
        if (!socket) return;

        const initialUser: Omit<User, 'id'> = {
            name,
            status: DEFAULTS.USER_STATUS,
            position: DEFAULTS.INITIAL_POSITION,
            lastActiveAt: Date.now(),
        };

        socket.emit('room:join', { roomId, user: initialUser }, (response) => {
            if (response.success && response.userId) {
                setCurrentUser({ ...initialUser, id: response.userId });
            } else {
                setError(response.error || 'Failed to join room');
            }
        });
    }, []);

    const updatePosition = useCallback((position: CursorPosition) => {
        const socket = socketRef.current;
        if (!socket || !isConnected) return;

        socket.emit('cursor:move', position);

        // Optimistic update for current user
        if (currentUser) {
            setCurrentUser({ ...currentUser, position });
        }
    }, [isConnected, currentUser]);

    const updateStatus = useCallback((status: UserStatus) => {
        const socket = socketRef.current;
        if (!socket || !isConnected) return;

        socket.emit('status:update', status);

        // Optimistic update for current user
        if (currentUser) {
            setCurrentUser({ ...currentUser, status });
        }
    }, [isConnected, currentUser]);

    return {
        socket: socketRef.current,
        isConnected,
        users,
        currentUser,
        error,
        joinRoom,
        updatePosition,
        updateStatus
    };
};
