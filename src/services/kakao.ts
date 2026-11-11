import { Platform } from 'react-native';
import { ApiError } from '@/services/api/errors';

export class KakaoLoginCancelled extends Error {}
export function isKakaoLoginCancelled(error: unknown) { return error instanceof KakaoLoginCancelled; }

export async function getKakaoAccessToken(): Promise<string> {
    if (Platform.OS === 'web') throw new ApiError('KAKAO_UNSUPPORTED');
    try {
        // 네이티브 모듈은 플랫폼을 확인한 뒤에만 불러와요. SDK가 계정 로그인으로 폴백해요.
        const sdk: typeof import('@react-native-seoul/kakao-login') = require('@react-native-seoul/kakao-login');
        const result = await sdk.login();
        if (typeof result.accessToken !== 'string' || !result.accessToken) throw new ApiError('UNKNOWN_ERROR');
        return result.accessToken;
    } catch (error) {
        const native = error as { code?: string; message?: string } | null;
        // 양 플랫폼의 RNKakaoLogins 오류는 코드가 같아 내부 취소 표식만 확인해요.
        if (native?.code === 'RNKakaoLogins' && /Cancelled|Canceled|user cancelled|user canceled/i.test(native.message ?? '')) {
            throw new KakaoLoginCancelled();
        }
        throw new ApiError('KAKAO_AUTH_FAILED');
    }
}
