/**
 * Mastodon・Misskey など、ほかの実装との文書のやり取り（actor の文書・Follow・自己紹介の HTML）。
 */
import { describe, expect, it } from 'vitest';
import { buildResponse, readActivity } from '../activities';
import { buildActorDocument, plainTextToHtml, readActorDocument } from '../actor';
import { keyIdOf, rsaKeyIdOf } from '../protocol';
import { ed25519Multikey } from '../ubichill/multikey';
import { displayMultilineText, displayText } from './text';

const PEM =
    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1LfVLPHCozMxH2Mo\n-----END PUBLIC KEY-----';
const MISSKEY = 'https://misskey.example/users/9x2abc';

/** Misskey が返す actor の文書（必要なところだけ）。 */
const misskeyDoc = (patch: Record<string, unknown> = {}) => ({
    '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
    type: 'Person',
    id: MISSKEY,
    inbox: `${MISSKEY}/inbox`,
    outbox: `${MISSKEY}/outbox`,
    followers: `${MISSKEY}/followers`,
    sharedInbox: 'https://misskey.example/inbox',
    endpoints: { sharedInbox: 'https://misskey.example/inbox' },
    url: 'https://misskey.example/@syuilo',
    preferredUsername: 'syuilo',
    name: 'しゅいろ',
    summary: '<p><span>みすきー</span><br>つくってます &amp; ねこ</p>',
    icon: { type: 'Image', url: 'https://misskey.example/files/icon.webp' },
    manuallyApprovesFollowers: false,
    publicKey: { id: `${MISSKEY}#main-key`, type: 'Key', owner: MISSKEY, publicKeyPem: `${PEM}\n` },
    ...patch,
});

describe('ほかの実装の actor の文書を読む', () => {
    it('Misskey の文書から RSA の鍵・HTML の自己紹介を読む（Ed25519 の鍵は無い）', () => {
        const read = readActorDocument(misskeyDoc(), MISSKEY);
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.actor.keys).toEqual([]);
        expect(read.actor.rsaKeys).toEqual([{ id: `${MISSKEY}#main-key`, publicKeyPem: PEM }]);
        // 自己紹介の改行は残す（ほかの実装の自己紹介は長い。Misskey は 1500 文字まで）
        expect(read.actor.summary).toBe('みすきー\nつくってます & ねこ');
        expect(read.actor.sharedInbox).toBe('https://misskey.example/inbox');
    });

    it('自己紹介のリンクの行き先と、名前・自己紹介に使うカスタム絵文字（tag の Emoji）を読む。summary はつないだ文字', () => {
        const read = readActorDocument(
            misskeyDoc({
                name: 'しゅいろ :misskey:',
                summary: '<p>:ai: <a href="https://misskey-hub.net/">公式</a></p>',
                tag: [
                    { type: 'Emoji', name: ':misskey:', icon: { type: 'Image', url: 'https://s3.example/m.png' } },
                    { type: 'Emoji', name: ':ai:', icon: { type: 'Image', url: 'https://s3.example/ai.webp' } },
                ],
            }),
            MISSKEY,
        );
        if (!read.ok) throw new Error('読めない');
        expect(read.actor.name).toBe('しゅいろ :misskey:');
        expect(read.actor.bio).toEqual([
            { kind: 'text', text: ':ai: ' },
            { kind: 'link', text: '公式', href: 'https://misskey-hub.net/' },
        ]);
        expect(read.actor.summary).toBe(':ai: 公式');
        expect(read.actor.emojis.map((e) => e.name)).toEqual(['misskey', 'ai']);
    });

    it('ほかの actor が持ち主の鍵・actor の下にない鍵・PEM でない鍵は使わない', () => {
        const keys = (publicKey: unknown) => {
            const read = readActorDocument(misskeyDoc({ publicKey }), MISSKEY);
            return read.ok ? read.actor.rsaKeys : null;
        };
        expect(
            keys({ id: `${MISSKEY}#main-key`, owner: 'https://misskey.example/users/other', publicKeyPem: PEM }),
        ).toEqual([]);
        expect(keys({ id: 'https://evil.example/key', owner: MISSKEY, publicKeyPem: PEM })).toEqual([]);
        expect(keys({ id: `${MISSKEY}/main-key`, owner: MISSKEY, publicKeyPem: PEM })).toEqual([]);
        expect(keys({ id: `${MISSKEY}#main-key`, owner: MISSKEY, publicKeyPem: 'ssh-rsa AAAA' })).toEqual([]);
        // 配列でも読む
        expect(keys([{ id: `${MISSKEY}#main-key`, owner: MISSKEY, publicKeyPem: PEM }])).toHaveLength(1);
        // publicKey が無い・null の文書も読める
        expect(keys(null)).toEqual([]);
    });
});

describe('このサーバーの actor の文書（ほかの実装向け）', () => {
    const doc = buildActorDocument({
        id: 'https://a.example/ap/users/alice',
        type: 'Person',
        preferredUsername: 'alice',
        name: 'Alice',
        summary: '1 行目 <b>太字</b>\n2 行目\n\n段落',
        inbox: 'https://a.example/ap/users/alice/inbox',
        sharedInbox: 'https://a.example/ap/inbox',
        followers: 'https://a.example/ap/users/alice/followers',
        keyId: keyIdOf('https://a.example/ap/users/alice'),
        publicKeyMultibase: ed25519Multikey(new Uint8Array(32)),
        rsaKey: { keyId: rsaKeyIdOf('https://a.example/ap/users/alice'), publicKeyPem: PEM },
        manuallyApprovesFollowers: false,
        discoverable: true,
    });

    it('RSA の鍵を publicKey（Mastodon・Misskey の形）に、承認制・検索の可否・フォロワーを載せる', () => {
        expect(doc.publicKey).toEqual({
            id: 'https://a.example/ap/users/alice#main-key',
            owner: 'https://a.example/ap/users/alice',
            publicKeyPem: PEM,
        });
        expect(doc).toMatchObject({
            manuallyApprovesFollowers: false,
            discoverable: true,
            indexable: true,
            followers: 'https://a.example/ap/users/alice/followers',
        });
        expect(doc['@context']).toContain('https://w3id.org/security/v1');
    });

    it('自己紹介は段落と改行だけの HTML にし、中身はエスケープする', () => {
        expect(doc.summary).toBe('<p>1 行目 &lt;b&gt;太字&lt;/b&gt;<br>2 行目</p><p>段落</p>');
        expect(plainTextToHtml('"a" & \'b\'')).toBe('<p>&quot;a&quot; &amp; &#39;b&#39;</p>');
    });

    it('自分の文書を ubichill が読み直すと、Ed25519 と RSA の両方の鍵が取れ、自己紹介は改行ごと平文に戻る', () => {
        const read = readActorDocument(doc, 'https://a.example/ap/users/alice');
        expect(read.ok && read.actor.keys).toHaveLength(1);
        expect(read.ok && read.actor.rsaKeys).toHaveLength(1);
        expect(read.ok && read.actor.summary).toBe('1 行目 <b>太字</b>\n2 行目\n\n段落');
    });
});

describe('displayText（ほかのサーバーの文字列）', () => {
    it('段落・改行は空白にしてタグを除き、実体参照を 1 度だけ戻す', () => {
        expect(displayText('<p>a</p><p>b<br/>c</p>', 100)).toBe('a b c');
        expect(displayText('&lt;script&gt; &amp;lt; &#x1F431; &#20013; &unknown;', 100)).toBe(
            '<script> &lt; \u{1F431} 中 &unknown;',
        );
        expect(displayText('&#0; &#x110000;', 100)).toBe('&#0; &#x110000;');
    });

    it('改行を残す版: <br> は改行、段落の区切りは空行。行ごとに空白を詰め、空行は 1 つまで', () => {
        expect(displayMultilineText('<p>a<br>b</p><p>c</p>', 100)).toBe('a\nb\n\nc');
        expect(displayMultilineText('<p class="x">a</p>\n<p>b</p>', 100)).toBe('a\n\nb');
        expect(displayMultilineText('a\n\n\n\n  b \t c\u0007', 100)).toBe('a\n\nb c');
        expect(displayMultilineText('<p></p><p>  </p>', 100)).toBeNull();
        // 切ったあとに改行・空白で終わらない
        expect(displayMultilineText('ab\ncd', 3)).toBe('ab');
    });
});

describe('Follow（ほかの実装から）', () => {
    const follow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://misskey.example/follows/9x2abc/7Fq2aL',
        type: 'Follow',
        actor: MISSKEY,
        object: 'https://a.example/ap/users/alice',
    };

    it('Follow を読む（object は id か埋め込み）', () => {
        expect(readActivity(follow)).toEqual({
            ok: true,
            activity: { type: 'follow', id: follow.id, actor: MISSKEY, object: 'https://a.example/ap/users/alice' },
        });
        expect(
            readActivity({ ...follow, object: { id: 'https://a.example/ap/users/alice', type: 'Person' } }),
        ).toMatchObject({
            ok: true,
            activity: { type: 'follow', object: 'https://a.example/ap/users/alice' },
        });
        expect(readActivity({ ...follow, object: 3 })).toMatchObject({ ok: true, activity: { type: 'unknown' } });
    });

    it('Undo{Follow} の埋め込みから、Follow の相手も読む', () => {
        expect(
            readActivity({ id: 'https://misskey.example/undo/1', type: 'Undo', actor: MISSKEY, object: follow }),
        ).toEqual({
            ok: true,
            activity: {
                type: 'undo',
                id: 'https://misskey.example/undo/1',
                actor: MISSKEY,
                object: { id: follow.id, type: 'Follow', actor: MISSKEY, object: 'https://a.example/ap/users/alice' },
            },
        });
    });

    it('Accept{Follow} は受けた Follow をそのまま埋め込む', () => {
        expect(
            buildResponse('Accept', {
                id: 'https://a.example/ap/activities/1',
                actor: 'https://a.example/ap/users/alice',
                to: MISSKEY,
                object: { id: follow.id, type: 'Follow', actor: MISSKEY, object: 'https://a.example/ap/users/alice' },
            }),
        ).toMatchObject({
            type: 'Accept',
            to: [MISSKEY],
            object: { id: follow.id, type: 'Follow', actor: MISSKEY, object: 'https://a.example/ap/users/alice' },
        });
    });
});
