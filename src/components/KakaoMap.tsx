import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { Coordinate, MapBounds } from '@/utils/home-map';
import { buildMapHtml, isAllowedMapNavigation, parseMapMessage } from '@/components/map/map-html';

export type MapMarker = Coordinate & { id: number; isSupported: boolean };
export type KakaoMapProps = {
    center: Coordinate;
    myLocation: Coordinate | null;
    markers: MapMarker[];
    centerRevision?: number;
    bottomInset?: number;
    onRegionChange: (bounds: MapBounds) => void;
    onError?: () => void;
};

export default function KakaoMap({ center, myLocation, markers, centerRevision = 0, bottomInset = 0, onRegionChange, onError }: KakaoMapProps) {
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
        if (ready && !failed) web.current?.postMessage(JSON.stringify({ type: 'state', center, myLocation, markers, revision: centerRevision }));
    }, [ready, failed, center, myLocation, markers, centerRevision]);

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
