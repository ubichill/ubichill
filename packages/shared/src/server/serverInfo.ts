/**
 * サーバーの情報（コントロールパネルの「全般」）。紹介のページ・ログインの画面・NodeInfo に出す（どれも公開）。
 */
import { z } from 'zod';

export const DEFAULT_SERVER_NAME = 'Ubichill';
/** 紹介を書いていないときに出す */
export const DEFAULT_SERVER_DESCRIPTION = '同じ空間で、作業も会話もいっしょに。';
export const UBICHILL_REPOSITORY_URL = 'https://github.com/ubichill/ubichill';

export const SERVER_INFO_LIMITS = { name: 64, description: 2000, maintainerName: 64, email: 254, url: 2048 } as const;

/** 英数字で終わる語の後には空白を入れる（「URL には」「紹介は」） */
const withLabel = (label: string, rest: string): string =>
    /[A-Za-z0-9]$/.test(label) ? `${label} ${rest}` : `${label}${rest}`;

const HttpUrl = z.url({ protocol: /^https?$/ });

/** 空は null にする */
const optionalText = (max: number, label: string) =>
    z
        .string()
        .trim()
        .max(max, withLabel(label, `は ${max} 文字までにしてください`))
        .nullable()
        .transform((value) => (value ? value : null));

const optionalUrl = (label: string) =>
    z
        .string()
        .trim()
        .max(SERVER_INFO_LIMITS.url, withLabel(label, 'が長すぎます'))
        .refine(
            (value) => value === '' || HttpUrl.safeParse(value).success,
            withLabel(label, 'には http(s) の URL を入れてください'),
        )
        .nullable()
        .transform((value) => (value ? value : null));

export const ServerInfoSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, 'サーバー名を入れてください')
        .max(SERVER_INFO_LIMITS.name, `サーバー名は ${SERVER_INFO_LIMITS.name} 文字までにしてください`),
    description: optionalText(SERVER_INFO_LIMITS.description, 'サーバーの紹介'),
    maintainerName: optionalText(SERVER_INFO_LIMITS.maintainerName, '管理者の名前'),
    maintainerEmail: z
        .string()
        .trim()
        .max(SERVER_INFO_LIMITS.email, '管理者のメールアドレスが長すぎます')
        .refine(
            (value) => value === '' || z.email().safeParse(value).success,
            '管理者のメールアドレスの形が正しくありません',
        )
        .nullable()
        .transform((value) => (value ? value : null)),
    tosUrl: optionalUrl('利用規約の URL'),
    privacyPolicyUrl: optionalUrl('プライバシーポリシーの URL'),
    inquiryUrl: optionalUrl('問い合わせ先の URL'),
    repositoryUrl: optionalUrl('ソースコードの URL'),
    impressumUrl: optionalUrl('運営者情報の URL'),
});

export type ServerInfo = z.output<typeof ServerInfoSchema>;
export type ServerInfoInput = z.input<typeof ServerInfoSchema>;

export const DEFAULT_SERVER_INFO: ServerInfo = {
    name: DEFAULT_SERVER_NAME,
    description: null,
    maintainerName: null,
    maintainerEmail: null,
    tosUrl: null,
    privacyPolicyUrl: null,
    inquiryUrl: null,
    repositoryUrl: null,
    impressumUrl: null,
};

/** 紹介のページに出すもの（`GET /api/v1/server`） */
export interface ServerOverview {
    info: ServerInfo;
    registrationOpen: boolean;
    stats: { users: number };
}

/** コントロールパネルに出す今の設定（`GET /api/v1/admin/server-info`）。一度も保存していなければ updatedAt は null */
export interface ServerInfoSettings {
    info: ServerInfo;
    updatedAt: string | null;
}
