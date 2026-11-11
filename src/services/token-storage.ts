import { Platform } from 'react-native';

const KEY = 'linkro.refresh';
let access: string | null = null;
let refresh: string | null = null;
let blocked = false;
let queue: Promise<unknown> = Promise.resolve();
let deletionFailed = false;
const listeners = new Set<() => void>();
export function subscribeTokenStorage(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
function reportDeletion(failed: boolean) {
    deletionFailed = failed;
    listeners.forEach(fn => fn());
}
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const pending = queue.then(fn);
    queue = pending.catch(() => {});
    return pending;
};
const secure = () => require('expo-secure-store') as typeof import('expo-secure-store');
export const getAccessToken = () => access;
export const hasTokenDeletionFailed = () => deletionFailed;
export function readRefreshToken(): Promise<string | null> {
    const unavailable = blocked;
    const webValue = refresh;
    return serial(async () => {
        if (unavailable) return null;
        // 웹에서는 메모리만 사용하므로 새로고침하면 로그아웃돼요.
        if (Platform.OS === 'web') return webValue;
        try { return await secure().getItemAsync(KEY); } catch { return null; }
    });
}
export function saveTokens(a: string, r: string, valid: () => boolean): Promise<boolean> {
    return serial(async () => {
        if (!valid()) return false;
        try {
            if (Platform.OS !== 'web') await secure().setItemAsync(KEY, r);
            if (!valid()) return false;
            access = a; refresh = r; blocked = false; reportDeletion(false);
            return true;
        } catch {
            access = null; refresh = null; blocked = true;
            return false;
        }
    });
}
export function clearTokens(): Promise<boolean> {
    access = null; refresh = null; blocked = true;
    return serial(async () => {
        try {
            if (Platform.OS !== 'web') await secure().deleteItemAsync(KEY);
            reportDeletion(false);
            return true;
        } catch {
            // 메모리는 비웠어도 다음 실행에서 저장값이 다시 읽힐 수 있어요.
            reportDeletion(true);
            return false;
        }
    });
}
