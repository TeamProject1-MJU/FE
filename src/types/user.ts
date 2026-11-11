/**
 * 사용자 타입 (API 명세 v1.12 4.4~4.6 /users/me)
 */

/** 4.4 GET /users/me 응답 data */
export type User = {
    id: string;
    nickname: string;
    /** ISO-8601 */
    createdAt: string;
};

/** 4.5 PATCH 응답에는 가입 시각이 없어요. */
export type UserProfile = Pick<User, 'id' | 'nickname'>;

/** 4.5 PATCH /users/me 요청 (닉네임 2~20자, 중복 허용) */
export type UpdateNicknameRequest = {
    nickname: string;
};

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;

export type UserErrorCode = 'VALIDATION_ERROR' | 'TOKEN_INVALID' | 'NETWORK_ERROR';

export class UserError extends Error {
    code: UserErrorCode;

    constructor(code: UserErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}
