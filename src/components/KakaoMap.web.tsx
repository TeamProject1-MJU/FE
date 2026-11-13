/**
 * iframe srcdoc은 origin이 없어 카카오 도메인 검증에 실패하므로,
 * 현재 페이지에 JS SDK를 직접 추가하고 kakao.maps.load 콜백에서 지도를 만들어요.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { KakaoMapProps } from '@/components/KakaoMap';
import { createWebMap, loadMapSdk } from '@/components/map/map-web';

export type { KakaoMapProps, MapMarker } from '@/components/KakaoMap';

export default function KakaoMap(props: KakaoMapProps) {
    const { center, myLocation, markers, centerRevision = 0, bottomInset = 0, lines, fitBounds, fitRevision = 0, label = '주변 역 지도' } = props;
    const key = process.env.EXPO_PUBLIC_KAKAO_MAP_JS_KEY?.trim() ?? '';
    const container = useRef<HTMLDivElement>(null);
    const controller = useRef<ReturnType<typeof createWebMap> | null>(null);
    const failCurrent = useRef<() => void>(() => {});
    const latest = useRef(props);
    const [attempt, setAttempt] = useState(0);
    const [failed, setFailed] = useState(false);

    useEffect(() => { latest.current = props; }, [props]);
    useEffect(() => {
        let active = true;
        let reported = false;
        let observer: ResizeObserver | undefined;
        const node = container.current;
        const fail = () => {
            if (!active || reported) return;
            reported = true;
            clearTimeout(timer);
            observer?.disconnect();
            controller.current?.dispose(); controller.current = null;
            setFailed(true); latest.current.onError?.();
        };
        const timer = setTimeout(fail, 15000);
        failCurrent.current = fail;
        void loadMapSdk(key).then(sdk => {
            if (!active || reported || !node) return;
            const created = createWebMap(node, sdk, latest.current, {
                onRegionChange: bounds => latest.current.onRegionChange(bounds),
                onReady: () => clearTimeout(timer),
                onError: fail,
            });
            if (reported) { created.dispose(); return; }
            controller.current = created;
            if (typeof ResizeObserver !== 'undefined') {
                observer = new ResizeObserver(() => {
                    try { controller.current?.resize(); } catch { fail(); }
                });
                observer.observe(node);
            }
        }).catch(fail);
        return () => {
            active = false;
            failCurrent.current = () => {};
            clearTimeout(timer);
            observer?.disconnect();
            controller.current?.dispose(); controller.current = null;
            node?.replaceChildren();
        };
    }, [key, attempt]);

    useEffect(() => {
        try { controller.current?.update({ center, myLocation, markers, centerRevision, lines, fitBounds, fitRevision }); }
        catch { failCurrent.current(); }
    }, [center, myLocation, markers, centerRevision, lines, fitBounds, fitRevision]);

    return <View style={[styles.container, { marginBottom: bottomInset }]}>
        <div ref={container} aria-label={label} style={{ position: 'absolute', inset: 0 }} />
        {failed && <View style={styles.error}>
            <Text style={styles.text}>지도를 불러오지 못했어요. 연결과 지도 설정을 확인해 주세요.</Text>
            <Pressable accessibilityRole="button" onPress={() => { setFailed(false); setAttempt(value => value + 1); }} style={styles.retry}>
                <Text style={styles.text}>다시 시도</Text>
            </Pressable>
        </View>}
    </View>;
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#eef1f5' },
    error: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#eef1f5' },
    text: { color: '#0f1c3f', textAlign: 'center', fontSize: 13 },
    retry: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#fff' },
});
