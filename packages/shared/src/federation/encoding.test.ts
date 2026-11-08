import { describe, expect, it } from 'vitest';
import { base58btcDecode, base58btcEncode, ed25519Multikey, parseEd25519Multikey } from './multikey';
import { base64ToBytes, bytesToBase64, parseDictionary, parseInnerList, serializeInnerList } from './structuredFields';

const ascii = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

describe('base64（標準・パディング付き）', () => {
    it.each([
        ['', ''],
        ['f', 'Zg=='],
        ['fo', 'Zm8='],
        ['foo', 'Zm9v'],
        ['foobar', 'Zm9vYmFy'],
    ])('RFC 4648 の例 %j ⇄ %j', (text, encoded) => {
        expect(bytesToBase64(ascii(text))).toBe(encoded);
        expect(base64ToBytes(encoded)).toEqual(ascii(text));
    });

    it('256 通りのバイトが往復する', () => {
        const all = Uint8Array.from({ length: 256 }, (_, i) => i);
        expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
    });

    it('長さ・文字・パディングの崩れた値は null', () => {
        expect(base64ToBytes('Zm9')).toBeNull();
        expect(base64ToBytes('Zm9v!')).toBeNull();
        expect(base64ToBytes('Z===')).toBeNull();
        expect(base64ToBytes('Zm8=Zm8=')).toBeNull();
    });
});

describe('base58btc', () => {
    it('既知の値（"Hello World!"）と、先頭の 0 は 1 になる', () => {
        expect(base58btcEncode(ascii('Hello World!'))).toBe('2NEpo7TZRRrLZSi2U');
        expect(base58btcDecode('2NEpo7TZRRrLZSi2U')).toEqual(ascii('Hello World!'));
        expect(base58btcEncode(Uint8Array.from([0, 0, 1]))).toBe('112');
        expect(base58btcDecode('112')).toEqual(Uint8Array.from([0, 0, 1]));
    });

    it('0・O・I・l は base58 に無い', () => {
        expect(base58btcDecode('0OIl')).toBeNull();
    });

    it('Ed25519 の Multikey は z6Mk で始まり往復する。ほかの種類・長さは受けない', () => {
        const key = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
        const multikey = ed25519Multikey(key);
        expect(multikey.startsWith('z6Mk')).toBe(true);
        expect(parseEd25519Multikey(multikey)).toEqual(key);
        expect(parseEd25519Multikey(`z${base58btcEncode(Uint8Array.from([0xec, 0x01, ...key]))}`)).toBeNull();
        expect(parseEd25519Multikey(`z${base58btcEncode(Uint8Array.from([0xed, 0x01, ...key.slice(1)]))}`)).toBeNull();
    });
});

describe('structured fields', () => {
    it('Signature-Input の inner list を読み、書き直すと同じ', () => {
        const text =
            '("@method" "@target-uri");created=1762506000;nonce="Xk4v0aP3m1pTqJ2w";keyid="https://a.example/ap/users/x#ed25519-1"';
        const list = parseInnerList(text);
        expect(list && serializeInnerList(list)).toBe(text);
    });

    it('文字列のエスケープ・空白・重複したキー（後の値が勝つ）', () => {
        const dict = parseDictionary(' a="x\\"y", b=?0,  a=1 ');
        expect(dict?.get('a')).toEqual({ kind: 'item', value: { type: 'integer', value: 1 }, params: [] });
        expect([...(dict?.keys() ?? [])]).toEqual(['b', 'a']);
    });

    it('小数・制御文字・閉じていない文字列・末尾のカンマ・大文字のキー・壊れたバイト列は受けない', () => {
        for (const bad of ['a=1.5', 'a="x\ny"', 'a="x', 'a=1,', 'A=1', 'a=:Zm9:']) {
            expect(parseDictionary(bad)).toBeNull();
        }
    });

    it('15 桁を超える整数は受けない', () => {
        expect(parseDictionary('a=1234567890123456')).toBeNull();
        expect(parseDictionary('a=999999999999999')?.get('a')).toMatchObject({ value: { value: 999999999999999 } });
    });
});
