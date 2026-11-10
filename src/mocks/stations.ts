import type { Line, Station, StationLine } from '@/types/station';

/**
 * 역 검색 mock 데이터.
 * API 명세 5.2 `GET /stations?keyword=` 응답의 items[] 형태를 그대로 따른다.
 * 화면과 서비스가 함께 쓰는 mock 데이터와 검색 함수이다.
 *
 * - id: 숫자 (명세: stationId, lineId는 숫자)
 * - isSupported: 서울교통공사 1~8호선 데이터 보유 역만 true. 코레일·신분당 등은 false ("미제공")
 * - lines[].color: 서버가 내려주는 값. 화면은 이 값을 그대로 쓴다.
 */

// 노선 마스터 (명세 5.1 GET /lines)
const LINE = {
    1: { lineId: 1, lineName: '1호선', color: '#0052A4' },
    2: { lineId: 2, lineName: '2호선', color: '#00A84D' },
    3: { lineId: 3, lineName: '3호선', color: '#EF7C1C' },
    4: { lineId: 4, lineName: '4호선', color: '#00A5DE' },
    5: { lineId: 5, lineName: '5호선', color: '#996CAC' },
    6: { lineId: 6, lineName: '6호선', color: '#CD7C2F' },
    7: { lineId: 7, lineName: '7호선', color: '#747F00' },
    8: { lineId: 8, lineName: '8호선', color: '#E6186C' },
    // 아래는 미제공 구간용 (코레일·민자)
    9: { lineId: 9, lineName: '9호선', color: '#BDB092' },
    101: { lineId: 101, lineName: '수인분당선', color: '#F5A200' },
    102: { lineId: 102, lineName: '신분당선', color: '#D4003B' },
    103: { lineId: 103, lineName: '경의중앙선', color: '#77C4A3' },
    104: { lineId: 104, lineName: '공항철도', color: '#0090D2' },
} as const;

type LineKey = keyof typeof LINE;

/**
 * 명세 5.1 `GET /lines` 모양의 mock 노선 목록.
 * lineCode 는 서버(DB 시드) 형식대로 노선 번호 문자열이에요(1호선 = "1" … 8호선 = "8").
 * 9호선·수인분당선 등(9, 101~104)은 같은 규칙으로 만든 mock 전용 값이에요.
 * 서버 호출이 실패했을 때 쓰는 기존 노선 값도 이 목록이에요.
 */
export const MOCK_LINES: Line[] = Object.values(LINE).map(({ lineId, lineName, color }) => ({
    id: lineId,
    lineCode: String(lineId),
    name: lineName,
    color,
}));

function line(key: LineKey, stationCode: string): StationLine {
    return { ...LINE[key], stationCode };
}

export const MOCK_STATIONS: Station[] = [
    { id: 101, name: '서울역', latitude: 37.5547, longitude: 126.9707, isSupported: true, lines: [line(1, '133'), line(4, '426')] },
    { id: 102, name: '시청', latitude: 37.5657, longitude: 126.9769, isSupported: true, lines: [line(1, '132'), line(2, '201')] },
    { id: 103, name: '종로3가', latitude: 37.5714, longitude: 126.9918, isSupported: true, lines: [line(1, '130'), line(3, '329'), line(5, '534')] },
    { id: 104, name: '동대문역사문화공원', latitude: 37.5651, longitude: 127.0092, isSupported: true, lines: [line(2, '205'), line(4, '422'), line(5, '536')] },
    { id: 105, name: '강남', latitude: 37.4979, longitude: 127.0276, isSupported: true, lines: [line(2, '222')] },
    { id: 106, name: '강남구청', latitude: 37.5172, longitude: 127.0411, isSupported: true, lines: [line(7, '730')] },
    { id: 107, name: '역삼', latitude: 37.5006, longitude: 127.0364, isSupported: true, lines: [line(2, '221')] },
    { id: 108, name: '교대', latitude: 37.4934, longitude: 127.0142, isSupported: true, lines: [line(2, '223'), line(3, '340')] },
    { id: 109, name: '사당', latitude: 37.4765, longitude: 126.9816, isSupported: true, lines: [line(2, '226'), line(4, '433')] },
    { id: 110, name: '서울대입구', latitude: 37.4813, longitude: 126.9527, isSupported: true, lines: [line(2, '228')] },
    { id: 111, name: '신림', latitude: 37.4842, longitude: 126.9296, isSupported: true, lines: [line(2, '230')] },
    { id: 112, name: '홍대입구', latitude: 37.5574, longitude: 126.9245, isSupported: true, lines: [line(2, '239')] },
    { id: 113, name: '신촌', latitude: 37.5551, longitude: 126.9368, isSupported: true, lines: [line(2, '240')] },
    { id: 114, name: '건대입구', latitude: 37.5403, longitude: 127.0702, isSupported: true, lines: [line(2, '212'), line(7, '727')] },
    { id: 115, name: '성수', latitude: 37.5446, longitude: 127.0559, isSupported: true, lines: [line(2, '211')] },
    { id: 116, name: '뚝섬', latitude: 37.5473, longitude: 127.0474, isSupported: true, lines: [line(2, '210')] },
    { id: 117, name: '강변', latitude: 37.5352, longitude: 127.0946, isSupported: true, lines: [line(2, '214')] },
    { id: 118, name: '잠실', latitude: 37.5133, longitude: 127.1001, isSupported: true, lines: [line(2, '216'), line(8, '814')] },
    { id: 119, name: '왕십리', latitude: 37.5614, longitude: 127.0375, isSupported: true, lines: [line(2, '208'), line(5, '540')] },
    { id: 120, name: '노원', latitude: 37.6553, longitude: 127.0614, isSupported: true, lines: [line(4, '411'), line(7, '711')] },
    { id: 121, name: '충무로', latitude: 37.5613, longitude: 126.9941, isSupported: true, lines: [line(3, '331'), line(4, '423')] },
    { id: 122, name: '을지로입구', latitude: 37.5660, longitude: 126.9826, isSupported: true, lines: [line(2, '202')] },
    { id: 123, name: '합정', latitude: 37.5498, longitude: 126.9139, isSupported: true, lines: [line(2, '238'), line(6, '622')] },
    { id: 124, name: '고속터미널', latitude: 37.5049, longitude: 127.0049, isSupported: true, lines: [line(3, '339'), line(7, '734')] },
    { id: 125, name: '천호', latitude: 37.5387, longitude: 127.1238, isSupported: true, lines: [line(5, '547'), line(8, '811')] },

    // 미제공 (서울교통공사 데이터 범위 밖)
    { id: 901, name: '서울숲', latitude: 37.5436, longitude: 127.0444, isSupported: false, lines: [line(101, 'K211')] },
    { id: 902, name: '용산', latitude: 37.5299, longitude: 126.9648, isSupported: false, lines: [line(1, '135'), line(103, 'K110')] },
    { id: 903, name: '판교', latitude: 37.3948, longitude: 127.1112, isSupported: false, lines: [line(102, 'D11')] },
    { id: 904, name: '수원', latitude: 37.2659, longitude: 127.0001, isSupported: false, lines: [line(1, 'P155'), line(101, 'K245')] },
    { id: 905, name: '홍대입구 (공항철도)', latitude: 37.5577, longitude: 126.9250, isSupported: false, lines: [line(104, 'A03')] },
    { id: 906, name: '여의도', latitude: 37.5216, longitude: 126.9243, isSupported: false, lines: [line(5, '527'), line(9, '915')] },
];

/** 역명 정규화: 공백 제거, 끝의 '역' 제거, 괄호 부역명 분리 */
export function normalizeStationName(value: string): string {
    return value
        .replace(/\s+/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/역$/, '')
        .toLowerCase();
}

/**
 * mock 검색. 명세 5.2처럼 keyword 부분 일치, 최대 50건.
 * 괄호 안 부역명도 검색 대상에 포함한다 (예: "강변" → "동서울터미널(강변)" 형태 대응).
 */
export function searchStations(keyword: string, limit = 50): Station[] {
    const q = normalizeStationName(keyword);
    if (!q) return [];

    const scored = MOCK_STATIONS
        .map((station) => {
            const name = normalizeStationName(station.name);
            const full = station.name.replace(/\s+/g, '').toLowerCase();
            let score = -1;
            if (name === q) score = 0;
            else if (name.startsWith(q)) score = 1;
            else if (name.includes(q)) score = 2;
            else if (full.includes(q)) score = 3;
            return { station, score };
        })
        .filter((item) => item.score >= 0)
        .sort((a, b) => {
            if (a.score !== b.score) return a.score - b.score;
            if (a.station.isSupported !== b.station.isSupported) return a.station.isSupported ? -1 : 1;
            return a.station.name.localeCompare(b.station.name, 'ko');
        });

    return scored.slice(0, limit).map((item) => item.station);
}

