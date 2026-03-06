'use client';

import { useSocket, useWorld } from '@ubichill/sdk';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { UbichillOverlay } from '@/components/UbichillOverlay';
import { useCursorState } from '@/core/hooks/useCursorState';
import { useSession } from '@/lib/auth-client';
import { css } from '@/styled-system/css';

export default function WorldPage() {
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const { data: session, isPending } = useSession();

    // Core SDK
    const { isConnected, error, joinWorld, updatePosition } = useSocket();
    const { environment } = useWorld();

    // UI states
    const [connecting, setConnecting] = useState(true);
    const hasJoinedRef = useRef(false);
    const cursorState = useCursorState();

    // Ensure auth and connect (1度だけ実行)
    useEffect(() => {
        if (isPending) return;

        if (!session) {
            router.push('/auth');
            return;
        }

        // 重複実行を防止
        if (hasJoinedRef.current) return;

        if (params.id) {
            hasJoinedRef.current = true;
            // "default" is a placeholder instance ID for simply joining the world's default instance space
            joinWorld(session.user.name, params.id, 'default');
            setConnecting(false);
        }
    }, [session, isPending, router, params.id, joinWorld]);

    if (isPending || connecting) {
        return (
            <div className={css({ minH: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                <p>接続中...</p>
            </div>
        );
    }

    if (error && !isConnected) {
        return (
            <div
                className={css({
                    minH: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDir: 'column',
                    gap: 4,
                })}
            >
                <p className={css({ color: 'red.500' })}>{error}</p>
                <button
                    type="button"
                    onClick={() => router.push('/')}
                    className={css({ padding: '8px 16px', bg: 'gray.200', rounded: 'md' })}
                >
                    戻る
                </button>
            </div>
        );
    }

    return (
        <main
            style={{
                width: '100vw',
                height: '100vh',
                position: 'relative',
                overflow: 'hidden',
                backgroundColor: environment?.backgroundColor || '#f8f9fa',
                backgroundImage: environment?.backgroundImage ? `url(${environment.backgroundImage})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
            }}
            onPointerMove={(e) => {
                updatePosition({ x: e.clientX, y: e.clientY }, cursorState);
            }}
        >
            <UbichillOverlay />
        </main>
    );
}
