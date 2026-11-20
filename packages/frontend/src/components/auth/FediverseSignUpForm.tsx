import type { FediverseSignUpCandidate } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import {
    cancelFediverseSignUp,
    completeFediverseSignUp,
    fetchFediverseSignUpCandidate,
} from '@/lib/account/fediverseSignIn';
import { useDisplayNameAvailability, useHandleAvailability } from '@/lib/account/useHandleAvailability';
import { css } from '@/styled-system/css';
import {
    buttonStyle,
    cardStyle,
    containerStyle,
    errorStyle,
    fieldErrorStyle,
    fieldStyle,
    fieldSuccessStyle,
    formStyle,
    hintStyle,
    inputErrorStyle,
    inputStyle,
    labelStyle,
    linkButtonStyle,
    subtitleStyle,
    titleStyle,
} from './authStyles';

type Loaded = { state: 'loading' } | { state: 'ready'; candidate: FediverseSignUpCandidate } | { state: 'expired' };

/** フェディバースのアカウントで初めて来た人に、Ubichill の ID と表示名を決めてもらう（候補は外部の名前から）。 */
export function FediverseSignUpForm({ onCancel }: { onCancel: () => void }) {
    const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
    const [handle, setHandle] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [busy, setBusy] = useState(false);
    const [avatarFailed, setAvatarFailed] = useState(false);
    const [error, setError] = useState('');
    const ready = loaded.state === 'ready';
    const handleStatus = useHandleAvailability(handle, ready);
    const displayNameStatus = useDisplayNameAvailability(displayName, ready);

    useEffect(() => {
        fetchFediverseSignUpCandidate()
            .then((candidate) => {
                setLoaded({ state: 'ready', candidate });
                setHandle(candidate.handle);
                setDisplayName(candidate.displayName);
            })
            .catch(() => setLoaded({ state: 'expired' }));
    }, []);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const blocking = [displayNameStatus, handleStatus].find((st) => st.state !== 'available');
        if (blocking) {
            setError('error' in blocking ? blocking.error : '表示名と ID を確認してください');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const returnTo = await completeFediverseSignUp({ handle: handle.trim(), displayName: displayName.trim() });
            // セッションを読み直すため、画面ごと移る
            window.location.assign(returnTo);
        } catch (err) {
            setError(err instanceof Error ? err.message : '登録に失敗しました');
            setBusy(false);
        }
    };

    if (loaded.state !== 'ready') {
        return (
            <main className={containerStyle}>
                <div className={cardStyle}>
                    <p className={subtitleStyle}>
                        {loaded.state === 'loading'
                            ? '読み込み中...'
                            : '登録の期限が切れました。もう一度フェディバースで続けてください。'}
                    </p>
                    {loaded.state === 'expired' && (
                        <button type="button" className={linkButtonStyle} onClick={onCancel}>
                            ログイン画面に戻る
                        </button>
                    )}
                </div>
            </main>
        );
    }

    const { candidate } = loaded;
    const account = `@${candidate.username}@${candidate.server}`;
    // やめたら途中の状態を消す（共用の端末で、別の人が続きから登録できないように）
    const cancel = () => {
        void cancelFediverseSignUp().finally(onCancel);
    };

    if (!candidate.registrationOpen) {
        return (
            <main className={containerStyle}>
                <div className={cardStyle}>
                    <p className={subtitleStyle}>
                        {account} はまだ登録されていません。現在、新規登録は受け付けていません。
                    </p>
                    <button type="button" className={linkButtonStyle} onClick={cancel}>
                        ログイン画面に戻る
                    </button>
                </div>
            </main>
        );
    }

    return (
        <main className={containerStyle}>
            <div className={cardStyle}>
                {candidate.avatarUrl && !avatarFailed && (
                    // 登録すると、このアイコンをプロフィールに取り込む（後から変えられる）
                    <img
                        src={candidate.avatarUrl}
                        alt=""
                        width={72}
                        height={72}
                        className={avatarStyle}
                        referrerPolicy="no-referrer"
                        onError={() => setAvatarFailed(true)}
                    />
                )}
                <h1 className={titleStyle}>はじめまして</h1>
                <p className={subtitleStyle}>
                    {candidate.notRegistered
                        ? `${account} はまだ登録されていません。ID と表示名を決めると、このまま登録できます。`
                        : `${account} で登録します。Ubichill での ID と表示名を決めてください。`}
                </p>
                <form onSubmit={submit} className={formStyle} aria-busy={busy}>
                    <div className={fieldStyle}>
                        <label htmlFor="fediverse-display-name" className={labelStyle}>
                            表示名
                        </label>
                        <input
                            id="fediverse-display-name"
                            type="text"
                            autoComplete="nickname"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value.slice(0, 30))}
                            aria-invalid={'error' in displayNameStatus}
                            aria-describedby="fediverse-display-name-status"
                            className={'error' in displayNameStatus ? inputErrorStyle : inputStyle}
                            required
                        />
                        <div id="fediverse-display-name-status" role="status">
                            {displayNameStatus.state === 'checking' && <p className={hintStyle}>確認中...</p>}
                            {'error' in displayNameStatus && (
                                <p className={fieldErrorStyle}>{displayNameStatus.error}</p>
                            )}
                            {displayNameStatus.state === 'available' && (
                                <p className={fieldSuccessStyle}>この表示名は使用できます</p>
                            )}
                        </div>
                    </div>
                    <div className={fieldStyle}>
                        <label htmlFor="fediverse-handle" className={labelStyle}>
                            ID
                        </label>
                        <input
                            id="fediverse-handle"
                            type="text"
                            autoComplete="off"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            value={handle}
                            onChange={(e) => setHandle(e.target.value.toLowerCase().slice(0, 30))}
                            aria-invalid={'error' in handleStatus}
                            aria-describedby="fediverse-handle-status fediverse-handle-hint"
                            className={'error' in handleStatus ? inputErrorStyle : inputStyle}
                            required
                        />
                        <div id="fediverse-handle-status" role="status">
                            {handleStatus.state === 'checking' && <p className={hintStyle}>確認中...</p>}
                            {'error' in handleStatus && <p className={fieldErrorStyle}>{handleStatus.error}</p>}
                            {handleStatus.state === 'available' && (
                                <p className={fieldSuccessStyle}>この ID は使用できます</p>
                            )}
                        </div>
                        <p id="fediverse-handle-hint" className={hintStyle}>
                            英小文字・数字・_ の 3〜30 文字。あとから変更できません
                        </p>
                    </div>
                    {error && (
                        <p role="alert" className={errorStyle}>
                            {error}
                        </p>
                    )}
                    <button
                        type="submit"
                        className={buttonStyle}
                        disabled={busy || handleStatus.state === 'checking' || displayNameStatus.state === 'checking'}
                    >
                        {busy ? '登録中...' : '登録して入る'}
                    </button>
                </form>
                <button type="button" className={linkButtonStyle} onClick={cancel}>
                    やめる
                </button>
            </div>
        </main>
    );
}

const avatarStyle = css({ w: '72px', h: '72px', rounded: 'full', objectFit: 'cover', bg: 'surfaceAccent' });
