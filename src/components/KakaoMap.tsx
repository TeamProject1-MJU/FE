import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { Coordinate, MapBounds } from '@/utils/home-map';
import { buildMapHtml, isAllowedMapNavigation, parseMapMessage } from '@/components/map/map-html';

/** color(#RRGGBB)가 있으면 그 색, 없으면 isSupported 로 색을 정해요. */
export type MapMarker = Coordinate & { id: number; isSupported: boolean; color?: string };
/** points 는 { latitude, longitude } 순서예요. dashed 는 점선(도보)이에요. */
export type MapLine = { id: number; color: string; points: Coordinate[]; dashed?: boolean };
export type KakaoMapProps = {
    center: Coordinate;
    myLocation: Coordinate | null;
    markers: MapMarker[];
    centerRevision?: number;
    bottomInset?: number;
    onRegionChange: (bounds: MapBounds) => void;
    onError?: () => void;
    /** 선택 값: 폴리라인. 넘기지 않으면 홈 지도처럼 선을 그리지 않아요. */
    lines?: MapLine[];
    /** 선택 값: 이 범위가 다 보이게 맞춰요. fitRevision 이 바뀔 때만 맞추고, 같은 번호로는 다시 맞추지 않아요. */
    fitBounds?: MapBounds | null;
    fitRevision?: number;
    /** 선택 값: 웹 지도 영역의 접근성 이름 */
    label?: string;
};

export default function KakaoMap({ center, myLocation, markers, centerRevision = 0, bottomInset = 0, onRegionChange, onError, lines, fitBounds, fitRevision = 0 }: KakaoMapProps) {
    const key = process.env.EXPO_PUBLIC_KAKAO_MAP_JS_KEY?.trim() ?? '';
    const source = useMemo(() => ({ html: buildMapHtml(key), baseUrl: 'https://localhost' }), [key]);
    const web = useRef<WebView>(null);
    const [attempt, setAttempt] = useState(0);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const failRef = useRef(onError);
    useEffect(() => { failRef.current = onError; }, [onError]);
    const fail = () => { setFailed(true); failRef.current?.(); };

    useEffect(() => {
        if (!key || ready || failed) return;
        const timer = setTimeout(() => { setFailed(true); failRef.current?.(); }, 15000);
        return () => clearTimeout(timer);
    }, [attempt, key, ready, failed]);
    useEffect(() => {
        if (!ready || failed) return;
        // 선택 값은 넘겼을 때만 메시지에 넣어요. 홈 지도의 메시지는 이전과 같아요.
        const fit = fitBounds ? { bounds: fitBounds, revision: fitRevision } : undefined;
        web.current?.postMessage(JSON.stringify({ type: 'state', center, myLocation, markers, revision: centerRevision, lines, fit }));
    }, [ready, failed, center, myLocation, markers, centerRevision, lines, fitBounds, fitRevision]);

    return <View style={[styles.container, { marginBottom: bottomInset }]}>
        {!!key && !failed && <WebView
            key={attempt}
            ref={web}
            style={styles.container}
            source={source}
            // WebView는 whitelist 밖 URL을 OS 브라우저로 보내므로 HTTPS는 아래 도메인 검사에서 직접 차단해요.
            originWhitelist={['https://*']}
            onShouldStartLoadWithRequest={request => isAllowedMapNavigation(request.url)}
            onOpenWindow={() => { /* 새 창 이동을 허용하지 않아요. */ }}
            javaScriptCanOpenWindowsAutomatically={false}
            allowsInlineMediaPlayback={false}
            geolocationEnabled={false}
            sharedCookiesEnabled={false}
            onError={fail}
            onHttpError={fail}
            onContentProcessDidTerminate={fail}
            onMessage={event => {
                const message = parseMapMessage(event.nativeEvent.data);
                if (message?.type === 'ready') setReady(true);
                else if (message?.type === 'error') fail();
                else if (message?.type === 'region') onRegionChange(message.bounds);
            }}
        />}
        {(!key || failed) && <View style={styles.error}>
            <Text style={styles.text}>지도를 불러오지 못했어요. 연결과 지도 설정을 확인해 주세요.</Text>
            <Pressable accessibilityRole="button" onPress={() => { setReady(false); setFailed(false); setAttempt(v => v + 1); }} style={styles.retry}>
                <Text style={styles.text}>다시 시도</Text>
            </Pressable>
        </View>}
    </View>;
}
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#eef1f5' },
    error: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', padding: 28 },
    text: { color: '#0f1c3f', textAlign: 'center', fontSize: 13 },
    retry: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#fff' },
});
