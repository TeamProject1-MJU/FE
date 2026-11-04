/**
 * 경로 검색 mock 데이터 (#34)
 *
 * 실제 POST /routes/search 연동 전까지 services/route.ts 에서 사용합니다.
 * 노선·방면·정차역은 실제 노선도 기준으로 맞췄고, 시간·요금은 예시 값입니다.
 *
 * 시나리오
 *  - 건대입구 ↔ 사당 : 카카오 경로 3개 (KAKAO)
 *  - 홍대입구 → 잠실 : 내부 대체 경로 1개 (INTERNAL, 예상 요금)
 *  - 신림 ↔ 노원     : 결과 없음 (ROUTE_NOT_FOUND)
 *  - 서울역 포함     : 검색 실패 (EXTERNAL_API_ERROR) → 다시 시도 확인용
 *  - 그 밖의 조합    : 결과 없음
 */

import type {
    Congestion,
    CongestionLevel,
    Route,
    RouteSearchResponse,
    RouteStep,
    RouteType,
    StationSummary,
} from '@/types/route';

const LINE_COLORS: Record<number, string> = {
    1: '#0052A4',
    2: '#00A84D',
    3: '#EF7C1C',
    4: '#00A5DE',
    5: '#996CAC',
    6: '#CD7C2F',
    7: '#747F00',
    8: '#E6186C',
};

const LEVEL_LABELS: Record<CongestionLevel, string> = {
    COMFORTABLE: '쾌적',
    RELAXED: '여유',
    NORMAL: '보통',
    CROWDED: '혼잡',
    VERY_CROWDED: '매우 혼잡',
};

const LEVEL_PCT: Record<CongestionLevel, number> = {
    COMFORTABLE: 28,
    RELAXED: 42,
    NORMAL: 78,
    CROWDED: 118,
    VERY_CROWDED: 162,
};

/** 역 선택 화면에서 쓰는 mock 역 목록 */
export const MOCK_STATIONS: StationSummary[] = [
    { id: 101, name: '건대입구', lines: [2, 7], isSupported: true },
    { id: 102, name: '사당', lines: [2, 4], isSupported: true },
    { id: 103, name: '홍대입구', lines: [2], isSupported: true },
    { id: 104, name: '잠실', lines: [2, 8], isSupported: true },
    { id: 105, name: '신림', lines: [2], isSupported: true },
    { id: 106, name: '노원', lines: [4, 7], isSupported: true },
    { id: 107, name: '서울역', lines: [1, 4], isSupported: true },
    { id: 108, name: '이수', lines: [4, 7], isSupported: true },
    { id: 109, name: '판교', lines: [], isSupported: false },
];

let stationSeq = 1000;
const stationIds = new Map<string, number>(MOCK_STATIONS.map(s => [s.name, s.id]));
const stationId = (name: string) => {
    if (!stationIds.has(name)) stationIds.set(name, stationSeq++);
    return stationIds.get(name)!;
};

const congestion = (level: CongestionLevel): Congestion => ({
    supported: true,
    kind: 'MOCK',
    pct: LEVEL_PCT[level],
    level,
    levelLabel: LEVEL_LABELS[level],
});

const LEVEL_ORDER: CongestionLevel[] = [
    'COMFORTABLE',
    'RELAXED',
    'NORMAL',
    'CROWDED',
    'VERY_CROWDED',
];

function walk(guidance: string, minutes: number, distanceM: number): RouteStep {
    return {
        type: 'WALKING',
        guidance,
        durationSec: minutes * 60,
        distanceM,
        line: null,
        direction: null,
        directionCode: null,
        stops: [],
        path: null,
    };
}

function subway(
    lineNo: number,
    direction: string,
    stopNames: string[],
    minutes: number,
    distanceM: number,
    /** 정차역 혼잡도. 개수가 모자라면 마지막 값을 이어서 씁니다. */
    levels: CongestionLevel[],
): RouteStep {
    const last = stopNames[stopNames.length - 1];
    return {
        type: 'SUBWAY',
        guidance: `${lineNo}호선 ${direction} 탑승, ${stopNames.length - 1}개 역 이동 후 ${last} 하차`,
        durationSec: minutes * 60,
        distanceM,
        line: { id: lineNo, name: `${lineNo}호선`, color: LINE_COLORS[lineNo] },
        direction,
        directionCode: null,
        stops: stopNames.map((name, index) => ({ id: stationId(name), name, order: index + 1 })),
        path: null,
        stations: stopNames.map((name, index) => ({
            id: stationId(name),
            name,
            slotStart: '18:30',
            slotDate: '',
            firstTrain: false,
            congestion: congestion(levels[Math.min(index, levels.length - 1)]),
        })),
    };
}

function maxCongestion(steps: RouteStep[]): Congestion {
    let max = -1;
    for (const step of steps) {
        for (const station of step.stations ?? []) {
            const level = station.congestion.level;
            if (level) max = Math.max(max, LEVEL_ORDER.indexOf(level));
        }
    }
    return max < 0
        ? { supported: false, kind: null, pct: null, level: null, levelLabel: null }
        : congestion(LEVEL_ORDER[max]);
}

function route(
    routeId: string,
    routeType: RouteType,
    minutes: number,
    fare: number,
    steps: RouteStep[],
    fareSource: 'KAKAO' | 'ESTIMATED' = 'KAKAO',
): Route {
    const subwaySteps = steps.filter(step => step.type === 'SUBWAY').length;
    const walkingSec = steps
        .filter(step => step.type === 'WALKING')
        .reduce((sum, step) => sum + step.durationSec, 0);

    return {
        routeId,
        routeType,
        summary: {
            totalTimeSec: minutes * 60,
            // 도착 시각은 검색할 때 services/route.ts 에서 현재 시각 기준으로 다시 계산합니다.
            arrivalAt: '',
            fare,
            fareSource,
            transferCount: Math.max(0, subwaySteps - 1),
            walkingMinutes: Math.round(walkingSec / 60),
            congestion: maxCongestion(steps),
        },
        steps,
    };
}

const LINE7_GEONDAE_TO_ISU = ['건대입구', '뚝섬유원지', '청담', '강남구청', '학동', '논현', '반포', '고속터미널', '내방', '이수'];
const LINE2_GEONDAE_TO_SADANG = ['건대입구', '구의', '강변', '잠실나루', '잠실', '잠실새내', '종합운동장', '삼성', '선릉', '역삼', '강남', '교대', '서초', '방배', '사당'];
const LINE2_HONGDAE_TO_JAMSIL = ['홍대입구', '신촌', '이대', '아현', '충정로', '시청', '을지로입구', '을지로3가', '을지로4가', '동대문역사문화공원', '신당', '상왕십리', '왕십리', '한양대', '뚝섬', '성수', '건대입구', '구의', '강변', '잠실나루', '잠실'];
const reverse = (names: string[]) => [...names].reverse();

/** 건대입구 → 사당 */
const GEONDAE_TO_SADANG: Route[] = [
    route('r1', 'FASTEST', 27, 1650, [
        subway(7, '석남 방면', LINE7_GEONDAE_TO_ISU, 18, 11700, ['NORMAL', 'NORMAL', 'NORMAL', 'RELAXED']),
        walk('이수역 4호선 승강장으로 환승', 3, 210),
        subway(4, '오이도 방면', ['이수', '사당'], 2, 1000, ['CROWDED']),
    ]),
    route('r2', 'FEWER_TRANSFERS', 31, 1750, [
        subway(2, '잠실 방면', LINE2_GEONDAE_TO_SADANG, 29, 17400, ['RELAXED', 'NORMAL']),
    ]),
    // 실제 분류(routeType)는 서버 응답 확인 후 맞춥니다.
    route('r3', 'CHEAPEST', 34, 1650, [
        subway(7, '석남 방면', LINE7_GEONDAE_TO_ISU.slice(0, 8), 14, 9300, ['COMFORTABLE']),
        walk('고속터미널역 3호선 승강장으로 환승', 3, 250),
        subway(3, '오금 방면', ['고속터미널', '교대'], 2, 1600, ['COMFORTABLE']),
        walk('교대역 2호선 승강장으로 환승', 2, 150),
        subway(2, '사당 방면', ['교대', '서초', '방배', '사당'], 6, 3600, ['RELAXED', 'COMFORTABLE']),
    ]),
];

/** 사당 → 건대입구 */
const SADANG_TO_GEONDAE: Route[] = [
    route('r1', 'FASTEST', 27, 1650, [
        subway(4, '진접 방면', ['사당', '이수'], 2, 1000, ['NORMAL']),
        walk('이수역 7호선 승강장으로 환승', 3, 210),
        subway(7, '장암 방면', reverse(LINE7_GEONDAE_TO_ISU), 18, 11700, ['RELAXED', 'NORMAL', 'CROWDED', 'NORMAL']),
    ]),
    route('r2', 'FEWER_TRANSFERS', 31, 1750, [
        subway(2, '강남 방면', reverse(LINE2_GEONDAE_TO_SADANG), 29, 17400, ['NORMAL']),
    ]),
    route('r3', 'CHEAPEST', 34, 1650, [
        subway(2, '강남 방면', ['사당', '방배', '서초', '교대'], 6, 3600, ['COMFORTABLE']),
        walk('교대역 3호선 승강장으로 환승', 2, 150),
        subway(3, '대화 방면', ['교대', '고속터미널'], 2, 1600, ['COMFORTABLE']),
        walk('고속터미널역 7호선 승강장으로 환승', 3, 250),
        subway(7, '장암 방면', reverse(LINE7_GEONDAE_TO_ISU.slice(0, 8)), 14, 9300, ['RELAXED']),
    ]),
];

/** 홍대입구 → 잠실 (내부 대체 경로) */
const HONGDAE_TO_JAMSIL_INTERNAL: Route[] = [
    route('r1', 'FASTEST', 42, 1850, [
        subway(2, '성수 방면', LINE2_HONGDAE_TO_JAMSIL, 42, 24600, ['NORMAL', 'CROWDED', 'NORMAL']),
    ], 'ESTIMATED'),
];

export type MockRouteResult =
    | { kind: 'success'; data: RouteSearchResponse }
    | { kind: 'notFound' }
    | { kind: 'error' };

/** 출발역·도착역 이름으로 mock 결과를 고릅니다. */
export function findMockRoutes(from: string, to: string): MockRouteResult {
    const pair = `${from}>${to}`;

    if (from === '서울역' || to === '서울역') return { kind: 'error' };
    if (pair === '건대입구>사당') return { kind: 'success', data: { routeSource: 'KAKAO', routes: GEONDAE_TO_SADANG } };
    if (pair === '사당>건대입구') return { kind: 'success', data: { routeSource: 'KAKAO', routes: SADANG_TO_GEONDAE } };
    if (pair === '홍대입구>잠실') return { kind: 'success', data: { routeSource: 'INTERNAL', routes: HONGDAE_TO_JAMSIL_INTERNAL } };

    return { kind: 'notFound' };
}