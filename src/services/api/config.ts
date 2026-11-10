/** Expo가 빌드할 때 치환할 수 있도록 환경변수를 점 표기법으로 읽습니다. */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
export const USE_MOCK = (process.env.EXPO_PUBLIC_USE_MOCK ?? 'true') === 'true';

export function useMock(): boolean {
    return USE_MOCK;
}

export function requireApiBaseUrl(): string {
    if (!API_BASE_URL) {
        throw new Error('서버 주소가 없어요. EXPO_PUBLIC_API_BASE_URL에 /api/v1로 끝나는 서버 주소를 설정해 주세요.');
    }
    return API_BASE_URL;
}

if (!USE_MOCK) requireApiBaseUrl();
