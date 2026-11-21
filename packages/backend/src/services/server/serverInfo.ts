/**
 * サーバーの情報（コントロールパネルの「全般」）。紹介のページ・NodeInfo に出す。保存していなければ既定の値。
 */
import {
    DEFAULT_SERVER_INFO,
    type ServerInfo,
    ServerInfoSchema,
    type ServerInfoSettings,
    type ServerOverview,
} from '@ubichill/shared';

export interface ServerInfoDeps {
    repository: {
        get(): Promise<(ServerInfo & { updatedAt: Date }) | null>;
        put(info: ServerInfo): Promise<void>;
    };
    countPeople(): Promise<number>;
    registrationOpen: boolean;
}

export type ServerInfoUpdateOutcome =
    | { ok: true; value: ServerInfoSettings }
    | { ok: false; status: 400; error: string };

export type ServerInfoService = ReturnType<typeof createServerInfo>;

export function createServerInfo(deps: ServerInfoDeps) {
    const settings = async (): Promise<ServerInfoSettings> => {
        const row = await deps.repository.get();
        if (!row) return { info: DEFAULT_SERVER_INFO, updatedAt: null };
        const { updatedAt, ...info } = row;
        return { info, updatedAt: updatedAt.toISOString() };
    };

    return {
        settings,

        async info(): Promise<ServerInfo> {
            return (await settings()).info;
        },

        async overview(): Promise<ServerOverview> {
            const [{ info }, users] = await Promise.all([settings(), deps.countPeople()]);
            return { info, registrationOpen: deps.registrationOpen, stats: { users } };
        },

        async update(input: unknown): Promise<ServerInfoUpdateOutcome> {
            const parsed = ServerInfoSchema.safeParse(input);
            if (!parsed.success) {
                return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? '入力が正しくありません' };
            }
            await deps.repository.put(parsed.data);
            return { ok: true, value: await settings() };
        },
    };
}
