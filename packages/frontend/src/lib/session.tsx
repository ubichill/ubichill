import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSession as useBetterAuthSession } from '@/lib/auth-client';

/**
 * セッション購読を「アプリ全体で 1 箇所」に集約し、一過性の取得失敗で
 * ログアウト扱いにならないよう耐性を持たせる。
 *
 * 背景:
 *   better-auth の useSession は購読のたびに初回 get-session を投げ、最初の同時
 *   フェッチは dedupe されない。CursorLayer や各ページ・ProtectedRoute が個別に
 *   useSession していたため、ロード時に get-session が複数同時発火していた。
 *   さらに、Ingress/ネットワークの一瞬の失敗や 5 分キャッシュ境界での再取得失敗で
 *   data が null になると「まれに勝手にログアウト」していた。
 *
 * 方針:
 *   - SessionProvider が「唯一の購読者」として 1 回だけ useSession し、結果を配る。
 *   - get-session が一過性に失敗（network / 5xx など 401 以外）したときは、直近の
 *     確立済みセッションを維持する（=ログアウトしない）。
 *   - data=null かつ error 無し（=サーバが明示的に未認証と回答）、もしくは 401 の
 *     ときだけ「本当に未認証」とみなして null を配る。
 *   - 一過性失敗中はバックオフで refetch し、復帰したら本物の session に戻す。
 */

type SessionState = ReturnType<typeof useBetterAuthSession>;

type SessionContextValue = SessionState & { forgetSession: () => void };
const SessionContext = createContext<SessionContextValue | null>(null);

/** 一過性失敗時の refetch バックオフ（ms）。回数とともに伸ばす。 */
const RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000] as const;

/** error が「本当に未認証(401)」かどうか。それ以外（network/5xx/タイムアウト）は一過性とみなす。 */
export function isUnauthorized(error: SessionState['error']): boolean {
    const status = (error as { status?: number } | null)?.status;
    return status === 401;
}

/**
 * 直近で確立できたセッション。サーバーが未認証と明示したら（ログアウト後など）忘れる。
 * 忘れないと、その後の一過性の失敗で前の人のセッションを配ってしまう。
 */
export function nextLastGoodSession(raw: SessionState, prev: SessionState['data']): SessionState['data'] {
    if (isUnauthorized(raw.error)) return null;
    if (raw.data) return raw.data;
    if (!raw.isPending && !raw.error) return null;
    return prev;
}

/** 一過性失敗（401 以外の error）の間は直近セッションを維持してログアウトを防ぐ。 */
export function resilientSession(raw: SessionState, lastGood: SessionState['data']): SessionState {
    if (isUnauthorized(raw.error)) return { ...raw, data: null };
    if (raw.data) return raw;
    if (raw.error && lastGood) {
        return { ...raw, data: lastGood, error: null };
    }
    return raw;
}

/** Better Auth はサインアウト直後の取得に失敗すると、終了済みのセッションを返すことがある。 */
export function withoutEndedSession(raw: SessionState, endedId: string | null): SessionState {
    return endedId && raw.data?.session.id === endedId ? { ...raw, data: null, error: null, isPending: false } : raw;
}

export function SessionProvider({ children }: { children: ReactNode }) {
    // アプリ内で唯一の useSession 購読。これにより get-session は 1 回に集約される。
    const authSession = useBetterAuthSession();
    const [endedId, setEndedId] = useState<string | null>(null);
    const raw = useMemo(() => withoutEndedSession(authSession, endedId), [authSession, endedId]);

    const lastGoodRef = useRef<SessionState['data']>(null);
    lastGoodRef.current = nextLastGoodSession(raw, lastGoodRef.current);
    const resilient = useMemo(() => resilientSession(raw, lastGoodRef.current), [raw]);
    const sessionId = lastGoodRef.current?.session.id;
    const forgetSession = useCallback(() => {
        if (!sessionId) return;
        if (lastGoodRef.current?.session.id === sessionId) lastGoodRef.current = null;
        setEndedId(sessionId);
    }, [sessionId]);

    // 一過性失敗中はバックオフで再取得を試みる（復帰したら本物の session に戻る）。
    const attemptRef = useRef(0);
    useEffect(() => {
        if (raw.data) {
            attemptRef.current = 0;
            return;
        }
        if (raw.isPending || !raw.error || isUnauthorized(raw.error)) return;
        const delay = RETRY_BACKOFF_MS[Math.min(attemptRef.current, RETRY_BACKOFF_MS.length - 1)];
        attemptRef.current += 1;
        const timer = setTimeout(() => void raw.refetch(), delay);
        return () => clearTimeout(timer);
    }, [raw]);

    const value = useMemo(() => ({ ...resilient, forgetSession }), [resilient, forgetSession]);
    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * 集約されたセッション状態を取得する。
 * Better Auth の状態と、サインアウト成功時に呼ぶ forgetSession を返す。
 */
export function useSession(): SessionContextValue {
    const ctx = useContext(SessionContext);
    if (!ctx) {
        throw new Error('useSession は SessionProvider の内側で使用してください');
    }
    return ctx;
}
