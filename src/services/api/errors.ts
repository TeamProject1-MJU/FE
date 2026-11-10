/** 서버 문구가 없을 때 사용할 기본 안내입니다. 필요한 서버 코드를 여기에 추가합니다. */
export const API_ERROR_MESSAGES: Readonly<Record<string, string>> = {
    NETWORK_ERROR: '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.',
    UNKNOWN_ERROR: '서버 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
    VALIDATION_ERROR: '입력한 내용을 확인해 주세요.',
    TOKEN_INVALID: '로그인 정보를 확인할 수 없어요. 다시 로그인해 주세요.',
    STATION_NOT_FOUND: '역 정보를 찾지 못했어요.',
    STATION_UNSUPPORTED: '서비스에서 지원하지 않는 역이에요.',
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
