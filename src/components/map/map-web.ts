import type { KakaoMapProps } from '@/components/KakaoMap';
import { isCoordinate, isMapBounds, type Coordinate, type MapBounds } from '@/utils/home-map';

type Point = { getLat(): number; getLng(): number };
type Overlay = { setMap(map: WebMap | null): void };
type WebMap = {
    setCenter(point: Point): void;
    getCenter(): Point;
    getBounds(): { getSouthWest(): Point; getNorthEast(): Point };
    relayout(): void;
};
export type MapSdk = {
    load(callback: () => void): void;
    LatLng: new (latitude: number, longitude: number) => Point;
    Map: new (container: HTMLElement, options: { center: Point; level: number }) => WebMap;
    CustomOverlay: new (options: { map: WebMap; position: Point; content: HTMLElement; yAnchor: number; zIndex: number }) => Overlay;
    event: {
        addListener(map: WebMap, event: string, callback: () => void): void;
        removeListener(map: WebMap, event: string, callback: () => void): void;
    };
};
type MapWindow = Window & { kakao?: { maps?: MapSdk } };
const SCRIPT_ID = 'linkro-kakao-maps-sdk';
const loads = new WeakMap<Document, { key: string; promise: Promise<MapSdk> }>();

export function mapSdkUrl(key: string) {
    return `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key.trim())}&autoload=false`;
}

/** 페이지 단위로 로딩을 공유하고 실패한 스크립트만 제거하여 재시도를 허용해요. */
export function loadMapSdk(key: string, host: MapWindow = window): Promise<MapSdk> {
    key = key.trim();
    if (!key) return Promise.reject(new Error('Map SDK key unavailable'));
    const doc = host.document;
    const existing = loads.get(doc);
    if (existing) return existing.key === key ? existing.promise : Promise.reject(new Error('Map SDK configuration changed'));
    const promise = new Promise<MapSdk>((resolve, reject) => {
        let settled = false;
        let script: HTMLScriptElement | null = null;
        const cleanup = () => {
            clearTimeout(timer);
            script?.removeEventListener('load', loaded);
            script?.removeEventListener('error', failed);
        };
        const failed = () => {
            if (settled) return;
            settled = true;
            cleanup();
            script?.remove();
            reject(new Error('Map SDK unavailable'));
        };
        const loaded = () => {
            if (settled) return;
            try {
                const sdk = host.kakao?.maps;
                if (!sdk) { failed(); return; }
                sdk.load(() => {
                    if (settled) return;
                    if (!sdk.Map || !sdk.LatLng || !sdk.CustomOverlay) { failed(); return; }
                    settled = true;
                    cleanup();
                    resolve(sdk);
                });
            } catch { failed(); }
        };
        const timer = setTimeout(failed, 15000);
        if (host.kakao?.maps) { loaded(); return; }
        const previous = doc.getElementById(SCRIPT_ID);
        if (previous) { failed(); return; }
        try {
            script = doc.createElement('script');
            script.id = SCRIPT_ID;
            script.async = true;
            script.src = mapSdkUrl(key);
            script.addEventListener('load', loaded);
            script.addEventListener('error', failed);
            doc.head.appendChild(script);
        } catch { failed(); }
    });
    loads.set(doc, { key, promise });
    void promise.catch(() => { if (loads.get(doc)?.promise === promise) loads.delete(doc); });
    return promise;
}

type MapState = Pick<KakaoMapProps, 'center' | 'myLocation' | 'markers' | 'centerRevision'>;
export function validMapState(state: MapState) {
    return isCoordinate(state.center) && (state.myLocation === null || isCoordinate(state.myLocation))
        && Number.isSafeInteger(state.centerRevision ?? 0) && Array.isArray(state.markers) && state.markers.length <= 500
        && state.markers.every(marker => isCoordinate(marker) && Number.isSafeInteger(marker.id) && typeof marker.isSupported === 'boolean');
}

export function mapBounds(map: WebMap): MapBounds | null {
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest(); const ne = bounds.getNorthEast();
    const result = { minLng: sw.getLng(), minLat: sw.getLat(), maxLng: ne.getLng(), maxLat: ne.getLat() };
    return isMapBounds(result) ? result : null;
}

/** React와 분리한 웹 지도 수명 주기. 홈의 디바운스에 bounds를 그대로 전달해요. */
export function createWebMap(container: HTMLElement, sdk: MapSdk, initial: MapState,
    callbacks: { onRegionChange(bounds: MapBounds): void; onReady(): void; onError(): void }) {
    if (!validMapState(initial)) throw new Error('Invalid map state');
    const point = (p: Coordinate) => new sdk.LatLng(p.latitude, p.longitude);
    const map = new sdk.Map(container, { center: point(initial.center), level: 5 });
    let disposed = false;
    let overlays: Overlay[] = [];
    let lastCenter: Coordinate | null = null;
    let lastRevision: number | undefined;
    const clearOverlays = () => { overlays.forEach(overlay => overlay.setMap(null)); overlays = []; };
    const dot = (p: Coordinate, color: string, mine: boolean) => {
        const el = container.ownerDocument.createElement('div');
        el.style.cssText = `width:16px;height:16px;border:3px solid white;border-radius:50%;box-shadow:0 1px 4px #555;pointer-events:none;background-color:${color}`;
        overlays.push(new sdk.CustomOverlay({ map, position: point(p), content: el, yAnchor: 0.5, zIndex: mine ? 2 : 1 }));
    };
    const region = () => {
        if (disposed) return;
        try { const bounds = mapBounds(map); if (bounds) callbacks.onRegionChange(bounds); }
        catch { callbacks.onError(); }
    };
    const ready = () => { if (!disposed) callbacks.onReady(); };
    const update = (state: MapState) => {
        if (disposed || !validMapState(state)) return;
        if (!lastCenter || lastCenter.latitude !== state.center.latitude || lastCenter.longitude !== state.center.longitude || lastRevision !== (state.centerRevision ?? 0)) {
            map.setCenter(point(state.center));
            lastCenter = { ...state.center }; lastRevision = state.centerRevision ?? 0;
        }
        clearOverlays();
        state.markers.forEach(marker => dot(marker, marker.isSupported ? '#12a77a' : '#8c93a3', false));
        if (state.myLocation) dot(state.myLocation, '#2879ef', true);
    };
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        sdk.event.removeListener(map, 'idle', region);
        sdk.event.removeListener(map, 'tilesloaded', ready);
        clearOverlays();
        container.replaceChildren();
    };
    try {
        sdk.event.addListener(map, 'idle', region);
        sdk.event.addListener(map, 'tilesloaded', ready);
        update(initial);
        region();
    } catch (error) { dispose(); throw error; }
    return {
        update,
        dispose,
        resize() {
            if (disposed) return;
            // 시트 높이가 달라져도 사용자가 이동한 지도 중심을 유지해요.
            const center = map.getCenter(); map.relayout(); map.setCenter(center); region();
        },
    };
}
