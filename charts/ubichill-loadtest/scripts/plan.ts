// 利用者（iteration）→ 部屋・役割・アカウントの割り当て。k6 のモジュールに依存しない（vitest で確かめる）。

/** k6-operator の runner の何番目か（--execution-segment から）。runner が 1 つなら { index: 0, count: 1 }。 */
export interface RunnerSlot {
    readonly index: number;
    readonly count: number;
}

const fraction = (text: string): number => {
    const [num, den] = text.trim().split('/');
    const value = den === undefined ? Number(num) : Number(num) / Number(den);
    if (!Number.isFinite(value)) throw new Error(`execution segment を読めません: ${text}`);
    return value;
};

const EPSILON = 1e-9;

/**
 * k6-operator は runner i/n に `--execution-segment=i/n:(i+1)/n --execution-segment-sequence=0,1/n,...,1` を渡す。
 * 部屋を runner ごとに分けるために、自分が何番目かを segment の始まりの位置から求める。
 */
export function runnerSlot(segment: string | undefined | null, sequence: string | undefined | null): RunnerSlot {
    if (!segment) return { index: 0, count: 1 };
    const [startText, endText] = segment.includes(':') ? segment.split(':') : ['0', segment];
    const start = fraction(startText ?? '0');
    const end = fraction(endText ?? '1');
    if (!sequence) {
        const count = Math.round(1 / (end - start));
        return { index: Math.round(start * count), count };
    }
    const points = sequence.split(',').map(fraction);
    const index = points.findIndex((p) => Math.abs(p - start) < EPSILON);
    if (index < 0 || index >= points.length - 1)
        throw new Error(`segment ${segment} が sequence ${sequence} にありません`);
    return { index, count: points.length - 1 };
}

/** 部屋の数が runner の数で割り切れないと、同じ部屋の人が別の runner に分かれる（時計が揃わず遅延を測れない）。 */
export const roomsPerRunner = (rooms: number, slot: RunnerSlot): number | null =>
    rooms % slot.count === 0 ? rooms / slot.count : null;

/** 部屋の中でカーソルを送る人数。1 人目（遅延の送り手）は ratio > 0 なら必ず含める。 */
export const activeCount = (usersPerRoom: number, activeRatio: number): number =>
    activeRatio <= 0 ? 0 : Math.min(usersPerRoom, Math.max(1, Math.round(usersPerRoom * activeRatio)));

export interface UserPlan {
    /** 試験の中で一意の利用者の番号（アカウントの番号の元） */
    readonly userIndex: number;
    readonly room: number;
    readonly indexInRoom: number;
    /** 部屋の 1 人目。インスタンスを作り、box を作って entity:patch を送り、カーソルに時刻を入れる */
    readonly creator: boolean;
    /** 部屋の 2 人目。1 人目のカーソルを受けて遅延を測る */
    readonly latencyReceiver: boolean;
    /** cursor:move を送る */
    readonly active: boolean;
    /** state:update を送る（1・2 人目。同じキーを書き合うので競合が起きる） */
    readonly stateWriter: boolean;
}

export interface PlanInput {
    readonly rooms: number;
    readonly usersPerRoom: number;
    readonly activeRatio: number;
}

/**
 * runner の中の iteration の番号（exec.scenario.iterationInInstance）から利用者を決める。
 * 同じ部屋の人は同じ runner に置く（遅延は 1 人目の時計で入れた時刻を 2 人目の時計で読むので、同じ Pod でないと測れない）。
 * 部屋は始まった順に埋まる（ランプの途中で増えた Go の Pod にも部屋が置かれる）。範囲の外なら null。
 */
export function planUser(input: PlanInput, slot: RunnerSlot, localIteration: number): UserPlan | null {
    const perRunner = roomsPerRunner(input.rooms, slot);
    if (perRunner === null || localIteration < 0 || localIteration >= perRunner * input.usersPerRoom) return null;
    const room = slot.index * perRunner + Math.floor(localIteration / input.usersPerRoom);
    const indexInRoom = localIteration % input.usersPerRoom;
    return {
        userIndex: room * input.usersPerRoom + indexInRoom,
        room,
        indexInRoom,
        creator: indexInRoom === 0,
        latencyReceiver: indexInRoom === 1,
        active: indexInRoom < activeCount(input.usersPerRoom, input.activeRatio),
        stateWriter: indexInRoom < 2,
    };
}

/** FNV-1a（32 bit）。走りの名前を短いタグにする */
export const fnv1a = (text: string): number =>
    Array.from(text).reduce((hash, ch) => Math.imul(hash ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0, 0x811c9dc5);

/**
 * インスタンスの access.tags に付ける部屋の印（20 文字まで）。2 人目以降はワールドのインスタンス一覧からこれで探す。
 * 走りの名前を混ぜるので、前の走りの消し忘れの部屋には入らない。
 */
export const roomTag = (testId: string, room: number): string => `lt${fnv1a(testId).toString(36)}r${room}`;

export interface LoadTestAccount {
    readonly email: string;
    readonly password: string;
    readonly displayName: string;
    readonly handle: string;
}

/** 負荷試験のアカウント。dev の DB は消えないので、同じ番号は走りをまたいで使い回す。 */
export function loadtestAccount(kind: 'user' | 'web', n: number, password: string): LoadTestAccount {
    if (!Number.isInteger(n) || n < 0) throw new Error(`アカウントの番号が不正です: ${n}`);
    const id = kind === 'user' ? `${n}` : `web${n}`;
    return {
        email: `loadtest+${id}@example.com`,
        password,
        displayName: `loadtest ${id}`,
        handle: `loadtest_${id}`,
    };
}
