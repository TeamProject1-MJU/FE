export type Coordinate = { latitude: number; longitude: number };
export type MapBounds = { minLng: number; minLat: number; maxLng: number; maxLat: number };
export const DEFAULT_MAP_CENTER: Coordinate = { latitude: 37.5665, longitude: 126.9780 };
export const LOCATION_GUIDANCE = '위치 권한을 켜면 내 주변이 보여요';
/** 카카오 일반 지도 약 2km 축척부터 역 점과 역 조회를 숨겨요. */
export const STATION_HIDE_LEVEL = 8;
export const STATION_ZOOM_GUIDANCE = '지도를 확대하면 역이 보여요';
export function isMapLevel(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 14;
}
export function shouldShowStations(level: number): boolean {
    return isMapLevel(level) && level < STATION_HIDE_LEVEL;
}
export function isCoordinate(value: unknown): value is Coordinate {
    if (!value || typeof value !== 'object') return false;
    const v = value as Coordinate;
    return typeof v.latitude === 'number' && typeof v.longitude === 'number'
        && Number.isFinite(v.latitude) && Math.abs(v.latitude) <= 90
        && Number.isFinite(v.longitude) && Math.abs(v.longitude) <= 180;
}
export function isMapBounds(value: unknown): value is MapBounds {
    if (!value || typeof value !== 'object') return false;
    const b = value as MapBounds;
    return [b.minLng, b.minLat, b.maxLng, b.maxLat].every(v => typeof v === 'number' && Number.isFinite(v))
        && b.minLng >= -180 && b.maxLng <= 180 && b.minLat >= -90 && b.maxLat <= 90
        && b.minLng < b.maxLng && b.minLat < b.maxLat;
}
export type LocationResult = { kind: 'granted'; coordinate: Coordinate } | { kind: 'denied' | 'failed' | 'timeout' };
export function resolveLocation(result: LocationResult) {
    if (result.kind === 'granted' && isCoordinate(result.coordinate)) {
        return { center: result.coordinate, myLocation: result.coordinate as Coordinate | null, guidance: '' };
    }
    return { center: DEFAULT_MAP_CENTER, myLocation: null as Coordinate | null, guidance: LOCATION_GUIDANCE };
}
