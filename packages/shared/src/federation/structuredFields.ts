/**
 * RFC 8941（Structured Field Values）の、HTTP の署名（RFC 9421）と Content-Digest（RFC 9530）に要るだけの部分。
 * Dictionary・Inner List・Parameters と、bare item の整数・文字列・トークン・バイト列・真偽値を読み書きする。
 * 小数は使わないので受けない（受けた値に小数があれば、その項目ごと読めない＝失敗にする）。
 */

export type BareItem =
    | { type: 'integer'; value: number }
    | { type: 'string'; value: string }
    | { type: 'token'; value: string }
    | { type: 'bytes'; value: Uint8Array }
    | { type: 'boolean'; value: boolean };

export type Parameters = Array<[string, BareItem]>;

export interface Item {
    kind: 'item';
    value: BareItem;
    params: Parameters;
}

export interface InnerList {
    kind: 'inner-list';
    items: Item[];
    params: Parameters;
}

export type DictionaryMember = Item | InnerList;

class ParseError extends Error {}

const KEY_START = /[a-z*]/;
const KEY_CHAR = /[a-z0-9_\-.*]/;
const TOKEN_START = /[A-Za-z*]/;
const TOKEN_CHAR = /[!#$%&'*+\-.^_`|~0-9A-Za-z:/]/;
const BASE64_CHAR = /[A-Za-z0-9+/=]/;
/** 整数の上限（RFC 8941: 15 桁） */
const MAX_INTEGER = 999_999_999_999_999;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 標準の base64（パディング付き）→ バイト列。形が崩れていれば null。 */
export function base64ToBytes(text: string): Uint8Array | null {
    if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
    const body = text.replace(/=+$/, '');
    const values = [...body].map((c) => B64.indexOf(c));
    const bits = values.flatMap((v) => [5, 4, 3, 2, 1, 0].map((shift) => (v >> shift) & 1));
    const bytes = Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
        bits.slice(i * 8, i * 8 + 8).reduce((acc, bit) => (acc << 1) | bit, 0),
    );
    return Uint8Array.from(bytes);
}

/** バイト列 → 標準の base64（パディング付き）。 */
export function bytesToBase64(bytes: Uint8Array): string {
    const chunks = Array.from({ length: Math.ceil(bytes.length / 3) }, (_, i) => bytes.slice(i * 3, i * 3 + 3));
    return chunks
        .map((chunk) => {
            const n = ((chunk[0] ?? 0) << 16) | ((chunk[1] ?? 0) << 8) | (chunk[2] ?? 0);
            const chars = [18, 12, 6, 0].map((shift) => B64[(n >> shift) & 63]);
            return chars.slice(0, chunk.length + 1).join('') + '='.repeat(3 - chunk.length);
        })
        .join('');
}

class Parser {
    pos = 0;
    constructor(readonly input: string) {}

    peek(): string {
        return this.input[this.pos] ?? '';
    }

    skipSP(): void {
        while (this.peek() === ' ') this.pos++;
    }

    skipOWS(): void {
        while (this.peek() === ' ' || this.peek() === '\t') this.pos++;
    }

    expect(char: string): void {
        if (!this.consume(char)) throw new ParseError(`expected ${char} at ${this.pos}`);
    }

    /** 次の文字が char なら読み進めて true。 */
    consume(char: string): boolean {
        if (this.peek() !== char) return false;
        this.pos++;
        return true;
    }

    key(): string {
        if (!KEY_START.test(this.peek())) throw new ParseError('bad key');
        const start = this.pos;
        while (KEY_CHAR.test(this.peek())) this.pos++;
        return this.input.slice(start, this.pos);
    }

    bareItem(): BareItem {
        const c = this.peek();
        if (c === '-' || /[0-9]/.test(c)) return this.integer();
        if (c === '"') return this.string();
        if (c === ':') return this.bytes();
        if (c === '?') return this.boolean();
        if (TOKEN_START.test(c)) return this.token();
        throw new ParseError('bad item');
    }

    integer(): BareItem {
        const start = this.pos;
        if (this.peek() === '-') this.pos++;
        const digits = this.pos;
        while (/[0-9]/.test(this.peek())) this.pos++;
        const length = this.pos - digits;
        if (length === 0 || length > 15) throw new ParseError('bad integer');
        // 小数（.）はこのプロファイルでは使わない
        if (this.peek() === '.') throw new ParseError('decimals are not supported');
        const value = Number(this.input.slice(start, this.pos));
        if (Math.abs(value) > MAX_INTEGER) throw new ParseError('integer out of range');
        return { type: 'integer', value };
    }

    string(): BareItem {
        this.expect('"');
        const chars: string[] = [];
        for (;;) {
            const c = this.peek();
            if (c === '') throw new ParseError('unterminated string');
            this.pos++;
            if (c === '\\') {
                const next = this.peek();
                if (next !== '"' && next !== '\\') throw new ParseError('bad escape');
                chars.push(next);
                this.pos++;
            } else if (c === '"') {
                return { type: 'string', value: chars.join('') };
            } else {
                const code = c.charCodeAt(0);
                if (code < 0x20 || code > 0x7e) throw new ParseError('bad string char');
                chars.push(c);
            }
        }
    }

    token(): BareItem {
        const start = this.pos;
        this.pos++;
        while (TOKEN_CHAR.test(this.peek())) this.pos++;
        return { type: 'token', value: this.input.slice(start, this.pos) };
    }

    bytes(): BareItem {
        this.expect(':');
        const start = this.pos;
        while (BASE64_CHAR.test(this.peek())) this.pos++;
        const text = this.input.slice(start, this.pos);
        this.expect(':');
        const value = base64ToBytes(text);
        if (!value) throw new ParseError('bad base64');
        return { type: 'bytes', value };
    }

    boolean(): BareItem {
        this.expect('?');
        const c = this.peek();
        if (c !== '0' && c !== '1') throw new ParseError('bad boolean');
        this.pos++;
        return { type: 'boolean', value: c === '1' };
    }

    params(): Parameters {
        const params: Parameters = [];
        while (this.peek() === ';') {
            this.pos++;
            this.skipSP();
            const key = this.key();
            const value: BareItem = this.consume('=') ? this.bareItem() : { type: 'boolean', value: true };
            const at = params.findIndex(([k]) => k === key);
            if (at >= 0) params.splice(at, 1);
            params.push([key, value]);
        }
        return params;
    }

    item(): Item {
        const value = this.bareItem();
        return { kind: 'item', value, params: this.params() };
    }

    innerList(): InnerList {
        this.expect('(');
        const items: Item[] = [];
        for (;;) {
            this.skipSP();
            if (this.peek() === ')') {
                this.pos++;
                return { kind: 'inner-list', items, params: this.params() };
            }
            items.push(this.item());
            const c = this.peek();
            if (c !== ' ' && c !== ')') throw new ParseError('bad inner list');
        }
    }

    member(): DictionaryMember {
        return this.peek() === '(' ? this.innerList() : this.item();
    }

    dictionary(): Map<string, DictionaryMember> {
        const dict = new Map<string, DictionaryMember>();
        this.skipSP();
        if (this.peek() === '') return dict;
        for (;;) {
            const key = this.key();
            const member: DictionaryMember = this.consume('=')
                ? this.member()
                : { kind: 'item', value: { type: 'boolean', value: true }, params: this.params() };
            dict.delete(key);
            dict.set(key, member);
            this.skipOWS();
            if (this.peek() === '') return dict;
            this.expect(',');
            this.skipOWS();
            if (this.peek() === '') throw new ParseError('trailing comma');
        }
    }
}

/** Dictionary を読む。形が崩れていれば null（どこが悪いかは呼び手に要らない）。 */
export function parseDictionary(input: string): Map<string, DictionaryMember> | null {
    try {
        return new Parser(input).dictionary();
    } catch (e) {
        if (e instanceof ParseError) return null;
        throw e;
    }
}

/** Inner List を 1 つ読む（Signature-Input の値）。 */
export function parseInnerList(input: string): InnerList | null {
    try {
        const parser = new Parser(input);
        const list = parser.innerList();
        if (parser.peek() !== '') return null;
        return list;
    } catch (e) {
        if (e instanceof ParseError) return null;
        throw e;
    }
}

export function serializeBareItem(item: BareItem): string {
    switch (item.type) {
        case 'integer':
            if (!Number.isInteger(item.value) || Math.abs(item.value) > MAX_INTEGER)
                throw new Error('integer out of range');
            return String(item.value);
        case 'string':
            if (!/^[\x20-\x7e]*$/.test(item.value)) throw new Error('string must be printable ASCII');
            return `"${item.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        case 'token':
            if (!/^[A-Za-z*][!#$%&'*+\-.^_`|~0-9A-Za-z:/]*$/.test(item.value)) throw new Error('bad token');
            return item.value;
        case 'bytes':
            return `:${bytesToBase64(item.value)}:`;
        case 'boolean':
            return item.value ? '?1' : '?0';
    }
}

export function serializeParams(params: Parameters): string {
    return params
        .map(([key, value]) =>
            value.type === 'boolean' && value.value ? `;${key}` : `;${key}=${serializeBareItem(value)}`,
        )
        .join('');
}

export function serializeInnerList(list: InnerList): string {
    const items = list.items.map((item) => `${serializeBareItem(item.value)}${serializeParams(item.params)}`);
    return `(${items.join(' ')})${serializeParams(list.params)}`;
}

export function serializeMember(member: DictionaryMember): string {
    return member.kind === 'inner-list'
        ? serializeInnerList(member)
        : `${serializeBareItem(member.value)}${serializeParams(member.params)}`;
}

export function serializeDictionary(dict: ReadonlyMap<string, DictionaryMember>): string {
    return [...dict]
        .map(([key, member]) =>
            member.kind === 'item' && member.value.type === 'boolean' && member.value.value
                ? `${key}${serializeParams(member.params)}`
                : `${key}=${serializeMember(member)}`,
        )
        .join(', ');
}
