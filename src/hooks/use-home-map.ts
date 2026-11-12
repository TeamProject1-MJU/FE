import { useCallback, useRef, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { getSessionGeneration } from '@/services/auth';
import { fetchStationsInBounds } from '@/services/station';
import { resolveLocation, type MapBounds, type LocationResult } from '@/utils/home-map';
import type { MapMarker } from '@/components/KakaoMap';

/** 웹 권한 팝업도 응답 없이 남을 수 있어요. 네이티브 권한 대기는 기존대로 둡니다. */
async function waitForPermission<T>(pending: Promise<T>): Promise<T> {
    if (Platform.OS !== 'web') return pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            pending,
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Location permission timeout')), 10000); }),
        ]);
    } finally { clearTimeout(timer); }
}

/** 한 번만 조회하며 타임아웃 뒤 도착한 네이티브 응답은 무시해요. */
async function readLocation(): Promise<LocationResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
                .then(position => ({ kind: 'granted' as const, coordinate: { latitude: position.coords.latitude, longitude: position.coords.longitude } })),
            new Promise<LocationResult>(resolve => { timer = setTimeout(() => resolve({ kind: 'timeout' }), 10000); }),
        ]);
    } catch { return { kind: 'failed' }; }
    finally { clearTimeout(timer); }
}

export function useHomeMap(enabled: boolean, account: string | null) {
    const [location, setLocation] = useState(() => ({ ...resolveLocation({ kind: 'denied' }), account }));
    const [stations, setStations] = useState<{ markers: MapMarker[]; truncated: boolean; account: string | null }>({ markers: [], truncated: false, account });
    const [centerRevision, setCenterRevision] = useState(0);
    const focused = useRef(false);
    const locationId = useRef(0);
    const stationId = useRef(0);
    const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const latestBounds = useRef<MapBounds | null>(null);
    const activeAccount = useRef(account);

    const locate = useCallback(async (requestPermission: boolean) => {
        if (!enabled || !focused.current) return;
        const id = ++locationId.current;
        const generation = getSessionGeneration();
        const valid = () => focused.current && id === locationId.current && generation === getSessionGeneration() && activeAccount.current === account;
        try {
            let permission = await waitForPermission(Location.getForegroundPermissionsAsync());
            if (!valid()) return;
            if (!permission.granted && requestPermission) permission = await waitForPermission(Location.requestForegroundPermissionsAsync());
            if (!valid()) return;
            const result = permission.granted ? await readLocation() : { kind: 'denied' as const };
            if (!valid()) return;
            setLocation({ ...resolveLocation(result), account });
            setCenterRevision(v => v + 1);
            if (!permission.granted && requestPermission) Alert.alert('위치 권한 안내', '설정에서 위치 권한을 켜면 내 주변을 볼 수 있어요.', [
                { text: '취소', style: 'cancel' },
                { text: '설정 열기', onPress: () => { void Linking.openSettings().catch(() => {}); } },
            ]);
        } catch {
            if (valid()) setLocation({ ...resolveLocation({ kind: 'failed' }), account });
            if (valid() && Platform.OS === 'web') setCenterRevision(v => v + 1);
        }
    }, [enabled, account]);

    const onRegionChange = useCallback((bounds: MapBounds) => {
        latestBounds.current = bounds;
        if (!enabled || !focused.current) return;
        clearTimeout(debounce.current);
        const id = ++stationId.current;
        const generation = getSessionGeneration();
        debounce.current = setTimeout(async () => {
            try {
                const result = await fetchStationsInBounds(bounds);
                if (!focused.current || id !== stationId.current || generation !== getSessionGeneration() || activeAccount.current !== account) return;
                setStations({ markers: result.items, truncated: result.totalElements > result.items.length, account });
            } catch { /* 이전 마커 유지. 인증 오류는 API 클라이언트에서 처리해요. */ }
        }, 400);
    }, [enabled, account]);

    useFocusEffect(useCallback(() => {
        activeAccount.current = account;
        focused.current = true;
        void locate(false);
        if (latestBounds.current) onRegionChange(latestBounds.current);
        return () => {
            focused.current = false;
            locationId.current++;
            stationId.current++;
            clearTimeout(debounce.current);
            // 위치는 이 화면의 메모리에만 두고 화면을 떠나면 제거해요.
            setLocation({ ...resolveLocation({ kind: 'denied' }), account: null });
        };
    }, [locate, onRegionChange, account]));

    return {
        ...(location.account === account ? location : resolveLocation({ kind: 'denied' })),
        markers: stations.account === account ? stations.markers : [],
        truncated: stations.account === account && stations.truncated,
        centerRevision, onRegionChange,
        locate: () => { void locate(true); },
    };
}
