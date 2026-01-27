'use client';

import { useState } from 'react';
import type { WorldEntity } from '@ubichill/shared';
import { PenWidget, useCreatePenWidget, GlobalCanvasProvider, type PenData } from '@/widgets/PenWidget';
import { useSocket } from '@/hooks/useSocket';
import { useWorld } from '@/hooks/useEntity';
import { css } from '../../../styled-system/css';

const containerStyle = css({
    padding: '20px',
    fontFamily: 'system-ui, sans-serif',
    minHeight: '100vh',
});

const headerStyle = css({
    marginBottom: '20px',
    position: 'relative',
    zIndex: 200,
});

const buttonStyle = css({
    padding: '10px 20px',
    backgroundColor: '#4a90d9',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    marginRight: '10px',
    '&:hover': {
        backgroundColor: '#357abd',
    },
    '&:disabled': {
        backgroundColor: '#ccc',
        cursor: 'not-allowed',
    },
});

const statusStyle = css({
    padding: '10px',
    backgroundColor: 'rgba(240, 240, 240, 0.9)',
    borderRadius: '8px',
    marginBottom: '20px',
    position: 'relative',
    zIndex: 200,
});

const toolbarStyle = css({
    position: 'relative',
    zIndex: 200,
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
});

const instructionStyle = css({
    marginTop: '40px',
    padding: '20px',
    backgroundColor: 'rgba(249, 249, 249, 0.95)',
    borderRadius: '8px',
    position: 'relative',
    zIndex: 200,
});

function PenTestContent() {
    const { isConnected, currentUser, joinRoom, error } = useSocket();
    const { entities, createEntity } = useWorld();
    const { createPenWidget } = useCreatePenWidget();
    const [name, setName] = useState('');
    const [hasJoined, setHasJoined] = useState(false);

    // ペン型のエンティティをフィルタリング
    const penEntities = Array.from(entities.values()).filter(
        (entity) => entity.type === 'pen'
    ) as unknown as WorldEntity<PenData>[];

    const handleJoin = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            joinRoom(name);
            setHasJoined(true);
        }
    };

    const handleCreatePen = async (color: string) => {
        await createPenWidget({
            x: 100 + penEntities.length * 60,
            y: 200 + (penEntities.length % 3) * 60,
            color,
            strokeWidth: 4,
        });
    };

    if (!hasJoined) {
        return (
            <div className={containerStyle}>
                <h1>🎨 UEP Pen Widget テスト</h1>
                <p style={{ marginBottom: '20px', color: '#666' }}>
                    ペンを持って画面全体に描画できます。複数のブラウザで同期をテストできます。
                </p>
                <form onSubmit={handleJoin}>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="名前を入力"
                        style={{
                            padding: '10px',
                            fontSize: '16px',
                            marginRight: '10px',
                            borderRadius: '4px',
                            border: '1px solid #ccc',
                        }}
                    />
                    <button type="submit" className={buttonStyle}>
                        参加
                    </button>
                </form>
                {error && <p style={{ color: 'red' }}>{error}</p>}
            </div>
        );
    }

    return (
        <div className={containerStyle}>
            <div className={headerStyle}>
                <h1>🎨 UEP Pen Widget テスト</h1>
            </div>

            <div className={statusStyle}>
                <p>
                    <strong>接続状態:</strong> {isConnected ? '✅ 接続中' : '❌ 未接続'}
                    {' | '}
                    <strong>ユーザー:</strong> {currentUser?.name ?? '未参加'}
                    {' | '}
                    <strong>ペン数:</strong> {penEntities.length}
                </p>
            </div>

            <div className={toolbarStyle}>
                <button
                    className={buttonStyle}
                    onClick={() => handleCreatePen('#000000')}
                    disabled={!isConnected}
                    style={{ backgroundColor: '#333' }}
                >
                    🖊️ 黒ペン
                </button>
                <button
                    className={buttonStyle}
                    onClick={() => handleCreatePen('#ff0000')}
                    disabled={!isConnected}
                    style={{ backgroundColor: '#cc0000' }}
                >
                    🖊️ 赤ペン
                </button>
                <button
                    className={buttonStyle}
                    onClick={() => handleCreatePen('#0066ff')}
                    disabled={!isConnected}
                    style={{ backgroundColor: '#0055cc' }}
                >
                    🖊️ 青ペン
                </button>
                <button
                    className={buttonStyle}
                    onClick={() => handleCreatePen('#00aa00')}
                    disabled={!isConnected}
                    style={{ backgroundColor: '#008800' }}
                >
                    🖊️ 緑ペン
                </button>
            </div>

            {/* ペンウィジェット - useWorldから取得した全エンティティを表示 */}
            {penEntities.map((entity) => (
                <PenWidget
                    key={entity.id}
                    entityId={entity.id}
                    initialEntity={entity}
                />
            ))}

            <div className={instructionStyle}>
                <h2>📝 使い方</h2>
                <ol style={{ lineHeight: '1.8' }}>
                    <li>上のボタンでペンを追加</li>
                    <li>ペンをクリック＆ドラッグで移動しながら描画</li>
                    <li>マウスを離すとストロークが確定</li>
                    <li>別のブラウザタブで同じ名前で参加すると同期を確認できます</li>
                </ol>
            </div>
        </div>
    );
}

export default function PenTestPage() {
    return (
        <GlobalCanvasProvider>
            <PenTestContent />
        </GlobalCanvasProvider>
    );
}
