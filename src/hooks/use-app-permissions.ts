import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { PERMISSION_DISPLAY, toPermissionState, type AppPermissionKey, type AppPermissionState } from '@/utils/app-permission';

/** 조회가 응답 없이 멈추면 확인할 수 없음으로 보여줘요. */
const QUERY_TIMEOUT = 5000;
/** 웹 권한 팝업은 응답 없이 남을 수 있어요. 네이티브 요청 대기는 사용자의 응답을 기다려요. */
const WEB_REQUEST_TIMEOUT = 10000;

async function withTimeout<T>(pending: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Permission timeout')), ms); })]);
    } finally { clearTimeout(timer); }
}
const query: Record<AppPermissionKey, () => Promise<unknown>> = {
    camera: () => ImagePicker.getCameraPermissionsAsync(),
    location: () => Location.getForegroundPermissionsAsync(),
};
const request: Record<AppPermissionKey, () => Promise<unknown>> = {
    camera: () => ImagePicker.requestCameraPermissionsAsync(),
    location: () => Location.requestForegroundPermissionsAsync(),
};
async function read(fn: () => Promise<unknown>, ms: number | null): Promise<AppPermissionState> {
    try { return toPermissionState(await (ms === null ? fn() : withTimeout(fn(), ms))); }
    catch { return 'unknown'; }
}

export type PermissionStates = Record<AppPermissionKey, AppPermissionState | 'loading'>;

/**
 * 카메라(expo-image-picker)·위치(expo-location, 사용 중 권한)의 실제 상태 (#130)
 *
 * - 화면에 들어올 때와 앱이 다시 앞으로 올 때(설정에서 돌아왔을 때) 다시 조회해요.
 * - 처음 조회가 끝나기 전에는 'loading' 이에요(가짜 값을 보여주지 않아요).
 * - 화면을 떠난 뒤 도착한 응답과 더 새로운 조회에 밀린 응답은 버려요.
 */
export function useAppPermissions() {
    const [states, setStates] = useState<PermissionStates>({ camera: 'loading', location: 'loading' });
    const focused = useRef(false);
    const ids = useRef<Record<AppPermissionKey, number>>({ camera: 0, location: 0 });
    const requesting = useRef(false);

    const apply = useCallback((key: AppPermissionKey, pending: Promise<AppPermissionState>) => {
        const id = ++ids.current[key];
        void pending.then(state => {
            if (!focused.current || id !== ids.current[key]) return;
            setStates(prev => (prev[key] === state ? prev : { ...prev, [key]: state }));
        });
    }, []);
    const refresh = useCallback(() => {
        if (!focused.current) return;
        for (const key of ['camera', 'location'] as const) apply(key, read(query[key], QUERY_TIMEOUT));
    }, [apply]);

    useFocusEffect(useCallback(() => {
        focused.current = true;
        refresh();
        return () => {
            focused.current = false;
            ids.current = { camera: ids.current.camera + 1, location: ids.current.location + 1 };
        };
    }, [refresh]));

    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
        return () => subscription.remove();
    }, [refresh]);

    const press = useCallback((key: AppPermissionKey) => {
        const state = states[key];
        if (state === 'loading') return;
        const action = PERMISSION_DISPLAY[state].action;
        // 권한 변경은 기기 설정에서 해요. 한 번도 요청하지 않은 권한은 iPhone 설정에 항목이 없어서 바로 요청해요.
        if (action === 'settings') { void Linking.openSettings().catch(() => undefined); return; }
        if (action === 'refresh') { refresh(); return; }
        if (requesting.current) return;
        requesting.current = true;
        const pending = read(request[key], Platform.OS === 'web' ? WEB_REQUEST_TIMEOUT : null);
        void pending.finally(() => { requesting.current = false; });
        apply(key, pending);
    }, [states, refresh, apply]);

    return { states, refresh, press };
}
