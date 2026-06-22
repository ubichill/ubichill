import { createContext, type ReactNode, useContext } from 'react';
import { useSession as useBetterAuthSession } from '@/lib/auth-client';

/**
 * セッション購読を「アプリ全体で 1 箇所」に集約する。
 *
 * 背景:
 *   better-auth の useSession は購読のたびに初回 get-session を投げ、最初の同時
 *   フェッチは dedupe されない。CursorLayer や各ページ・ProtectedRoute が個別に
 *   useSession していたため、ロード時に get-session が複数同時発火していた。
 *
 * 方針:
 *   SessionProvider が「唯一の購読者」として 1 回だけ useSession し、その結果を
 *   context で配る。各コンポーネントは @/lib/session の useSession を使うだけで、
 *   セッション取得の作法（リトライ/重複防止など）を一切意識しなくてよい。
 */

type SessionState = ReturnType<typeof useBetterAuthSession>;

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
    // アプリ内で唯一の useSession 購読。これにより get-session は 1 回に集約される。
    const session = useBetterAuthSession();
    return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/**
 * 集約されたセッション状態を取得する。
 * 返り値の形は better-auth の useSession と同一（{ data, isPending, error, refetch }）。
 */
export function useSession(): SessionState {
    const ctx = useContext(SessionContext);
    if (!ctx) {
        throw new Error('useSession は SessionProvider の内側で使用してください');
    }
    return ctx;
}
