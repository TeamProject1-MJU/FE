import { requireApiBaseUrl } from '@/services/api/config';
import { ApiError } from '@/services/api/errors';

export const REQUEST_TIMEOUT_MS = 10000;

export type QueryParams = Record<string, string | number | boolean | null | undefined>;
export type RequestOptions = {
    query?: QueryParams;
    /** 로그인처럼 인증 헤더가 필요 없는 요청은 false로 지정합니다. */
    auth?: boolean;
};
type AccessTokenProvider = () => string | null | undefined | Promise<string | null | undefined>;

let accessTokenProvider: AccessTokenProvider | null = null;

/** 토큰 조회 함수만 주입합니다. 저장·로그인·갱신·재시도는 여기서 처리하지 않습니다. */
export function setAccessTokenProvider(provider: AccessTokenProvider | null) {
    accessTokenProvider = provider;
}

function buildUrl(path: string, query?: QueryParams) {
    const url = `${requireApiBaseUrl()}/${path.replace(/^\/+/, '')}`;
    const params = Object.entries(query ?? {})
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
    return params ? `${url}${url.includes('?') ? '&' : '?'}${params}` : url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function request<T>(method: string, path: string, body: unknown, options: RequestOptions): Promise<T> {
    const url = buildUrl(path, options.query);
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
    };
    // TODO: 토큰 조회 실패·시간 제한 범위는 A-1(로그인)에서 확정합니다.
    const token = options.auth === false ? null : await accessTokenProvider?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        let response: Response;
        let text: string;
        try {
            response = await fetch(url, {
                method,
                headers,
                ...(serializedBody === undefined ? {} : { body: serializedBody }),
                signal: controller.signal,
            });
            text = await response.text();
        } catch {
            throw new ApiError('NETWORK_ERROR');
        }

        if (response.ok && !text.trim()) return undefined as T;

        let payload: unknown;
        try {
            payload = JSON.parse(text);
        } catch {
            throw new ApiError('UNKNOWN_ERROR', null, null, response.status);
        }

        if (isRecord(payload)) {
            if (payload.success === false && isRecord(payload.error) && typeof payload.error.code === 'string' && payload.error.code) {
                throw new ApiError(
                    payload.error.code,
                    typeof payload.error.message === 'string' ? payload.error.message : null,
                    payload.error.details ?? null,
                    response.status,
                );
            }
            if (response.ok && payload.success === true && Object.prototype.hasOwnProperty.call(payload, 'data')) {
                return payload.data as T;
            }
        }
        throw new ApiError('UNKNOWN_ERROR', null, null, response.status);
    } finally {
        clearTimeout(timeout);
    }
}

export function get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return request<T>('GET', path, undefined, options);
}

export function post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return request<T>('POST', path, body, options);
}

export function put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return request<T>('PUT', path, body, options);
}

export function patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return request<T>('PATCH', path, body, options);
}

// 예약어인 delete를 공개 이름으로 쓰기 위해 별칭으로 내보냅니다.
function deleteRequest<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
    return request<T>('DELETE', path, undefined, options);
}

export { deleteRequest as delete };
