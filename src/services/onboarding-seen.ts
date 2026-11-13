import { Platform } from 'react-native';

/**
 * 서버 모드 "온보딩·권한 안내를 본 적 있음" 표시 (#130)
 *
 * - 기기에만 저장하고 값은 표시 하나('1')뿐이에요(개인 정보 없음). 기기는 expo-secure-store, 웹은 localStorage.
 * - 읽기·쓰기는 예외를 던지지 않아요. 읽기에 실패하면 본 적 없는 것(false)으로 봐요.
 * - 로그아웃·탈퇴 때 지우지 않아요. mock 모드에서는 부르지 않아요.
 */
const KEY = 'linkro.onboardingSeen';
const SEEN = '1';
/** 저장이 응답 없이 멈춰도 다음 화면으로 갈 수 있게 기다리는 시간 */
export const ONBOARDING_SEEN_WRITE_TIMEOUT = 1000;

const secure = () => require('expo-secure-store') as typeof import('expo-secure-store');
function webStorage(): Storage | null {
    return typeof localStorage === 'undefined' ? null : localStorage;
}

export async function readOnboardingSeen(): Promise<boolean> {
    try {
        if (Platform.OS === 'web') return webStorage()?.getItem(KEY) === SEEN;
        return (await secure().getItemAsync(KEY)) === SEEN;
    } catch { return false; }
}

/** 저장에 성공하면 true. 실패하거나 시간 안에 끝나지 않으면 false 예요. */
export async function markOnboardingSeen(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = (async () => {
        try {
            if (Platform.OS === 'web') {
                const storage = webStorage();
                if (!storage) return false;
                storage.setItem(KEY, SEEN);
                return true;
            }
            await secure().setItemAsync(KEY, SEEN);
            return true;
        } catch { return false; }
    })();
    try {
        return await Promise.race([write, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), ONBOARDING_SEEN_WRITE_TIMEOUT); })]);
    } finally { clearTimeout(timer); }
}
