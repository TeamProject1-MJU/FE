/**
 * 경로 → 지도용 값 (#129)
 *
 * - 역 좌표는 응답에 없어요. 역 마커는 구간 경로선(path)의 양 끝점에 찍고, path 가 없는 구간은 선·마커를 생략해요.
 * - path 는 [경도, 위도] 순서예요(명세 6.1). 지도에는 { latitude, longitude } 로 바꾸고 범위 밖 점은 버려요.
 * - 색 우선순위: 혼잡도 색 > 노선 색 > 회색. 도보는 회색 점선.
 * - path 의 점이 하나도 버려지지 않았고 점 개수가 정차역(stops) 수와 같으면(2 이상, 시간표 경로) path 의 i번째 점을 stops[i] 로 보고
 *   역과 역 사이마다 출발 쪽 역(stops[i])의 혼잡도 색으로 칠해요. 그 역의 혼잡도는 stations 에서 같은 id, 없으면 같은 순서 i 의 항목이에요.
 *   같은 색이 이어지는 사이는 선 하나로 합치고, 이어지는 두 선은 경계 점을 함께 가져요.
 * - 그렇지 않은 지하철 구간(카카오 경로 등)은 역 위치를 알 수 없어 승차~하차 전체를 그 구간의 가장 높은 단계 색으로 칠해요.
 * - 나눈 결과가 지도 메시지 상한(isValidMapLines)을 넘으면 경로 전체를 나누지 않는 방식으로 그려요.
 * - 혼잡도 값은 서버가 준 level 을 그대로 쓰고 새로 계산하지 않아요.
 */
import type { MapLine, MapMarker } from '@/components/KakaoMap';
import type { RouteMarkerKind } from '@/components/map/route-marker-icons';
import { isHexColor, isValidMapLines, MAP_LIMITS } from '@/components/map/map-html';
import { CONGESTION_STYLE, UNSUPPORTED_COLOR } from '@/components/route/Congestion';
import type { Congestion, CongestionLevel, Route, RouteStep } from '@/types/route';
import { DEFAULT_MAP_CENTER, isCoordinate, type Coordinate, type MapBounds } from '@/utils/home-map';

/** 혼잡도 단계 순서(낮음 → 높음). 이름은 앱의 기존 표기(쾌적·여유·보통·혼잡·매우 혼잡)와 같아요. */
export const CONGESTION_LEVELS: readonly CongestionLevel[] = ['COMFORTABLE', 'RELAXED', 'NORMAL', 'CROWDED', 'VERY_CROWDED'];
export const CONGESTION_LEVEL_LABEL: Record<CongestionLevel, string> = {
    COMFORTABLE: '쾌적', RELAXED: '여유', NORMAL: '보통', CROWDED: '혼잡', VERY_CROWDED: '매우 혼잡',
};
/** 노선 색도 혼잡도도 없는 지하철 구간 */
export const NO_DATA_LINE_COLOR = UNSUPPORTED_COLOR;
/** 도보 구간(점선) */
export const WALK_LINE_COLOR = '#8c93a3';
export type { RouteMarkerKind } from '@/components/map/route-marker-icons';
export const ROUTE_MARKER_COLOR: Record<RouteMarkerKind, string> = { origin: '#2879ef', transfer: '#6a5ae0', destination: '#0f1c3f' };
export const ROUTE_MARKER_LABEL: Record<RouteMarkerKind, string> = { origin: '출발', transfer: '환승', destination: '도착' };
/** 점이 하나뿐이거나 폭이 0인 범위를 넓히는 양(도, 약 200m) */
const MIN_SPAN = 0.002;

export type RouteMapMarker = MapMarker & { kind: RouteMarkerKind; color: string };
export type RouteMapLegendLine = { id: number | null; name: string | null; color: string | null };
export type RouteMap = {
    lines: MapLine[];
    markers: RouteMapMarker[];
    /** 그릴 것이 없으면 null(기본 중심으로 지도만 보여줘요) */
    bounds: MapBounds | null;
    center: Coordinate;
    /** 이 경로가 지나는 노선, 타는 순서. 같은 노선이 연달아 나오면 한 번만. */
    routeLines: RouteMapLegendLine[];
    /** 혼잡도 색으로 칠한 구간이 있는지, 노선 색(또는 회색)으로 칠한 지하철 구간이 있는지 */
    usesCongestion: boolean;
    usesLineColor: boolean;
    /** 칠한 혼잡도 중 추정(ESTIMATED)·임시(MOCK)가 있는지 (Congestion.tsx 규칙) */
    estimated: boolean;
    mock: boolean;
};

/** [경도, 위도] 배열 → 좌표. 형식이 틀리거나 범위를 벗어난 점은 버려요. */
export function toCoordinates(path: unknown): Coordinate[] {
    if (!Array.isArray(path)) return [];
    const points: Coordinate[] = [];
    for (const pair of path) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const point = { latitude: pair[1], longitude: pair[0] };
        if (isCoordinate(point)) points.push(point);
    }
    return points;
}

/** 처음과 끝을 지키며 고르게 max 개 이하로 줄여요. */
export function thinPoints<T>(points: T[], max: number): T[] {
    const limit = Math.max(2, Math.floor(max));
    if (points.length <= limit) return points.slice();
    const result: T[] = [];
    for (let i = 0; i < limit; i++) result.push(points[Math.round((i * (points.length - 1)) / (limit - 1))]);
    return result;
}

/** 구간 stations[] 중 supported 이고 level 이 있는 것의 가장 높은 단계. 없으면 null. */
export function stepCongestion(step: RouteStep): Congestion | null {
    let best: Congestion | null = null;
    for (const station of step.stations ?? []) {
        const congestion = station?.congestion;
        if (!congestion?.supported || !congestion.level || !(congestion.level in CONGESTION_STYLE)) continue;
        if (!best || CONGESTION_LEVELS.indexOf(congestion.level) > CONGESTION_LEVELS.indexOf(best.level!)) best = congestion;
    }
    return best;
}

/** 구간 선 색: 도보 → 회색, 지하철 → 혼잡도 색 > 노선 색 > 회색 */
export function stepLineColor(step: RouteStep): string {
    if (step.type !== 'SUBWAY') return WALK_LINE_COLOR;
    const congestion = stepCongestion(step);
    if (congestion?.level) return CONGESTION_STYLE[congestion.level].color;
    const color = step.line?.color;
    return isHexColor(color) ? color : NO_DATA_LINE_COLOR;
}

/** 좌표들의 최소·최대. 점 하나·폭 0이면 조금 넓혀요. 좌표가 없으면 null. */
export function coordinateBounds(points: Coordinate[]): MapBounds | null {
    const valid = points.filter(isCoordinate);
    if (!valid.length) return null;
    let minLat = Math.min(...valid.map(p => p.latitude)); let maxLat = Math.max(...valid.map(p => p.latitude));
    let minLng = Math.min(...valid.map(p => p.longitude)); let maxLng = Math.max(...valid.map(p => p.longitude));
    if (maxLat - minLat < MIN_SPAN) { const mid = (minLat + maxLat) / 2; minLat = mid - MIN_SPAN / 2; maxLat = mid + MIN_SPAN / 2; }
    if (maxLng - minLng < MIN_SPAN) { const mid = (minLng + maxLng) / 2; minLng = mid - MIN_SPAN / 2; maxLng = mid + MIN_SPAN / 2; }
    // 극단 좌표에서 넓힌 범위가 밖으로 나가지 않게 안쪽으로 밀어요.
    if (minLat < -90) { maxLat += -90 - minLat; minLat = -90; }
    if (maxLat > 90) { minLat -= maxLat - 90; maxLat = 90; }
    if (minLng < -180) { maxLng += -180 - minLng; minLng = -180; }
    if (maxLng > 180) { minLng -= maxLng - 180; maxLng = 180; }
    return { minLng, minLat, maxLng, maxLat };
}

function sameLine(a: RouteMapLegendLine, b: RouteMapLegendLine) {
    if (a.id != null && b.id != null) return a.id === b.id;
    return a.name === b.name && a.color === b.color;
}

/** 나눠 칠한 구간의 id 간격. 나누지 않은 선의 id(step 번호, MAP_LIMITS.lines 미만)와 겹치지 않아요. */
const SECTION_ID_BASE = 1000;

/** path 점이 모두 유효하고 개수가 정차역 수(2 이상)와 같은 지하철 구간만 역 사이로 나눌 수 있어요. */
function canSplitStep(step: RouteStep, points: Coordinate[]) {
    return step.type === 'SUBWAY' && Array.isArray(step.path) && points.length === step.path.length
        && points.length >= 2 && points.length === (step.stops ?? []).length;
}

/** 정차역 i 의 혼잡도: stations 에서 같은 id, 없으면 같은 순서. 칠할 수 있는(supported·알려진 level) 값만 돌려줘요. */
function stopCongestion(step: RouteStep, index: number): Congestion | null {
    const stations = step.stations ?? [];
    const id = step.stops[index]?.id;
    const station = (id != null ? stations.find(item => item?.id === id) : undefined) ?? stations[index];
    const congestion = station?.congestion;
    return congestion?.supported && congestion.level && congestion.level in CONGESTION_STYLE ? congestion : null;
}

type Painted = { lines: MapLine[]; usesCongestion: boolean; usesLineColor: boolean; estimated: boolean; mock: boolean };

function paintLines(steps: RouteStep[], stepPoints: Coordinate[][], split: boolean): Painted {
    // 나누지 않는 선은 선 하나와 전체 점 개수 상한 안으로 고르게 줄여요.
    const drawn = stepPoints.filter(points => points.length >= 2).length;
    const perLine = Math.min(MAP_LIMITS.linePoints, Math.floor(MAP_LIMITS.totalPoints / Math.max(drawn, 1)));
    const result: Painted = { lines: [], usesCongestion: false, usesLineColor: false, estimated: false, mock: false };
    // 지도에 실제로 칠한 혼잡도만 범례 표시에 반영해요.
    const paint = (congestion: Congestion | null) => {
        if (congestion) {
            result.usesCongestion = true;
            if (congestion.kind === 'ESTIMATED') result.estimated = true;
            if (congestion.kind === 'MOCK') result.mock = true;
        } else result.usesLineColor = true;
    };
    steps.forEach((step, index) => {
        const subway = step.type === 'SUBWAY';
        const points = stepPoints[index];
        if (points.length < 2) return;
        if (split && canSplitStep(step, points)) {
            const lineColor = isHexColor(step.line?.color) ? step.line.color : NO_DATA_LINE_COLOR;
            let start = 0; let color = ''; let order = 0;
            for (let i = 0; i < points.length - 1; i++) {
                const congestion = stopCongestion(step, i);
                paint(congestion);
                const next = congestion?.level ? CONGESTION_STYLE[congestion.level].color : lineColor;
                if (i > 0 && next !== color) {
                    result.lines.push({ id: (index + 1) * SECTION_ID_BASE + order++, color, points: points.slice(start, i + 1) });
                    start = i;
                }
                color = next;
            }
            result.lines.push({ id: (index + 1) * SECTION_ID_BASE + order, color, points: points.slice(start) });
            return;
        }
        if (subway) paint(stepCongestion(step));
        result.lines.push({ id: index, color: stepLineColor(step), points: thinPoints(points, perLine), ...(subway ? {} : { dashed: true }) });
    });
    return result;
}

export function buildRouteMap(route: Route): RouteMap {
    const steps = (route.steps ?? []).slice(0, MAP_LIMITS.lines);
    const stepPoints = steps.map(step => toCoordinates(step.path));
    // 역 사이로 나눈 결과가 지도 상한을 넘으면 지도가 메시지를 통째로 무시하니 나누지 않는 방식으로 그려요.
    const sectioned = paintLines(steps, stepPoints, true);
    const { lines, usesCongestion, usesLineColor, estimated, mock } = isValidMapLines(sectioned.lines) ? sectioned : paintLines(steps, stepPoints, false);

    const markers: RouteMapMarker[] = [];
    const subwayIndexes = steps.map((step, index) => step.type === 'SUBWAY' ? index : -1).filter(index => index >= 0);
    const mark = (kind: RouteMarkerKind, point: Coordinate | undefined) => {
        if (point) markers.push({ id: markers.length, latitude: point.latitude, longitude: point.longitude, isSupported: true, kind, color: ROUTE_MARKER_COLOR[kind] });
    };
    subwayIndexes.forEach((stepIndex, order) => mark(order === 0 ? 'origin' : 'transfer', stepPoints[stepIndex][0]));
    if (subwayIndexes.length) mark('destination', stepPoints[subwayIndexes[subwayIndexes.length - 1]].at(-1));

    const routeLines: RouteMapLegendLine[] = [];
    for (const index of subwayIndexes) {
        const line = steps[index].line;
        const color = line?.color;
        const entry = { id: line?.id ?? null, name: line?.name?.trim() || null, color: isHexColor(color) ? color : null };
        if (entry.id == null && !entry.name && !entry.color) continue;
        const previous = routeLines[routeLines.length - 1];
        if (!previous || !sameLine(previous, entry)) routeLines.push(entry);
    }

    const bounds = coordinateBounds([...lines.flatMap(line => line.points), ...markers]);
    const center = bounds ? { latitude: (bounds.minLat + bounds.maxLat) / 2, longitude: (bounds.minLng + bounds.maxLng) / 2 } : DEFAULT_MAP_CENTER;
    return { lines, markers, bounds, center, routeLines, usesCongestion, usesLineColor, estimated, mock };
}
