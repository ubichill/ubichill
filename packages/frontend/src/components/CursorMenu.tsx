import { useRef, useState } from 'react';

interface CursorMenuProps {
    onCursorChange: (url: string | null) => void;
    currentCursorUrl: string | null;
}

export const CursorMenu: React.FC<CursorMenuProps> = ({ onCursorChange, currentCursorUrl }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleUrlSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (urlInput.trim()) {
            onCursorChange(urlInput.trim());
            setIsOpen(false);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const result = event.target?.result as string;
            if (result) {
                onCursorChange(result);
                setIsOpen(false);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleClear = () => {
        onCursorChange(null);
        setUrlInput('');
        setIsOpen(false);
    };

    return (
        <div style={{ position: 'relative' }}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '6px 12px',
                    backgroundColor: 'white',
                    border: '1px solid #dee2e6',
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                }}
            >
                <span>🖱️</span> Change Cursor
            </button>

            {isOpen && (
                <div
                    style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '8px',
                        backgroundColor: 'white',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        border: '1px solid #dee2e6',
                        padding: '16px',
                        width: '280px',
                        zIndex: 1000,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>Cursor Settings</h3>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            style={{
                                border: 'none',
                                background: 'none',
                                cursor: 'pointer',
                                fontSize: '16px',
                                padding: '0 4px',
                            }}
                        >
                            ×
                        </button>
                    </div>

                    {/* URL Input */}
                    <form onSubmit={handleUrlSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label
                            style={{
                                fontSize: '12px',
                                fontWeight: 'bold',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                            }}
                        >
                            Image URL
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="text"
                                    value={urlInput}
                                    onChange={(e) => setUrlInput(e.target.value)}
                                    placeholder="https://..."
                                    style={{
                                        flex: 1,
                                        padding: '6px',
                                        borderRadius: '4px',
                                        border: '1px solid #dee2e6',
                                        fontSize: '13px',
                                        fontWeight: 'normal',
                                    }}
                                />
                                <button
                                    type="submit"
                                    disabled={!urlInput.trim()}
                                    style={{
                                        padding: '6px 12px',
                                        backgroundColor: '#228be6',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        fontSize: '12px',
                                        cursor: 'pointer',
                                        opacity: urlInput.trim() ? 1 : 0.6,
                                    }}
                                >
                                    Set
                                </button>
                            </div>
                        </label>
                    </form>

                    <div style={{ height: '1px', backgroundColor: '#f1f3f5' }} />

                    {/* File Upload */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label
                            style={{
                                fontSize: '12px',
                                fontWeight: 'bold',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                            }}
                        >
                            Upload Image
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileUpload}
                                accept="image/*"
                                style={{ display: 'none' }}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                style={{
                                    padding: '8px',
                                    backgroundColor: '#f8f9fa',
                                    border: '1px solid #dee2e6',
                                    borderRadius: '4px',
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    textAlign: 'center',
                                    color: '#495057',
                                    width: '100%',
                                }}
                            >
                                Choose File...
                            </button>
                        </label>
                    </div>

                    {currentCursorUrl && (
                        <>
                            <div style={{ height: '1px', backgroundColor: '#f1f3f5' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '12px', color: '#868e96' }}>Current active</span>
                                <button
                                    type="button"
                                    onClick={handleClear}
                                    style={{
                                        padding: '4px 8px',
                                        backgroundColor: 'transparent',
                                        color: '#fa5252',
                                        border: '1px solid #fa5252',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        cursor: 'pointer',
                                    }}
                                >
                                    Reset to Default
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
