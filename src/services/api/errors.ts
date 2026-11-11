/** 서버 문구가 없을 때 사용할 기본 안내입니다. 필요한 서버 코드를 여기에 추가합니다. */
export const API_ERROR_MESSAGES: Readonly<Record<string, string>> = {
    KAKAO_AUTH_FAILED: '카카오 로그인에 실패했어요. 다시 시도해 주세요',
    EXTERNAL_API_ERROR: '카카오 서버와 연결이 불안정해요. 잠시 후 다시 시도해 주세요',
    KAKAO_UNSUPPORTED: '이 환경에서는 카카오 로그인을 쓸 수 없어요',
    TOKEN_STORAGE_ERROR: '로그인 정보를 안전하게 저장하지 못했어요. 다시 로그인해 주세요.',
    REFRESH_UNCERTAIN: '로그인 갱신 결과를 확인하지 못했어요. 카카오로 다시 로그인해 주세요.',
    NETWORK_ERROR: '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.',
    UNKNOWN_ERROR: '서버 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
    VALIDATION_ERROR: '입력한 내용을 확인해 주세요.',
    AUTH_REQUIRED: '로그인이 필요해요.',
    TOKEN_EXPIRED: '로그인이 만료됐어요. 다시 로그인해 주세요.',
    TOKEN_INVALID: '로그인 정보를 확인할 수 없어요. 다시 로그인해 주세요.',
    STATION_NOT_FOUND: '역 정보를 찾지 못했어요.',
    STATION_UNSUPPORTED: '서비스에서 지원하지 않는 역이에요.',
    NOT_FOUND: '해당 노선에서 그 역의 혼잡도를 찾지 못했어요.',
};

export class ApiError extends Error {
    readonly code: string;
    readonly details: unknown;
    readonly status: number | null;

    constructor(code: string, message?: string | null, details: unknown = null, status: number | null = null) {
        super(message?.trim() ? message : API_ERROR_MESSAGES[code] ?? API_ERROR_MESSAGES.UNKNOWN_ERROR);
        this.name = 'ApiError';
        this.code = code;
        this.details = details;
        this.status = status;
    }
}

/** 명세의 인증 오류(401) 코드예요. 갱신·재로그인 처리는 A-1(로그인)에서 해요. */
export const AUTH_ERROR_CODES: readonly string[] = ['AUTH_REQUIRED', 'TOKEN_EXPIRED', 'TOKEN_INVALID'];

export function isAuthError(error: unknown): boolean {
    return error instanceof ApiError && (error.status === 401 || AUTH_ERROR_CODES.includes(error.code));
}
