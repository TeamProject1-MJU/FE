/**
 * 혼잡도 조회 타입 (API 명세 v1.12 6.2 GET /congestion 기준)
 */

import type { Congestion, CongestionLevel } from '@/types/route';

export type DirectionCode = 'UP' | 'DOWN' | 'INNER' | 'OUTER' | 'LOOP';
export type DayType = 'WEEKDAY' | 'SATURDAY' | 'SUNDAY';
export type CongestionSource = 'PREDICTED' | 'ESTIMATED' | 'MOCK';

type CongestionQueryBase = {
    stationId: number;
    lineId: number;
    /** 서버 값을 그대로 보내요. 1호선은 UP = 소요산 방향, DOWN = 인천·신창 방향, 2호선은 INNER/OUTER 예요. */
    direction: DirectionCode;
    /** HH:mm (00:00~23:59) */
    time: string;
};

/**
 * 6.2 쿼리
 * - date(yyyy-MM-dd)가 있으면 서버가 영업일로 dayType 을 정하고 요청의 dayType 은 무시해요. 그래서 보내지 않아요.
 * - date 가 없으면 dayType 이 필수예요.
 */
export type CongestionQuery = CongestionQueryBase & (
    | { date: string; dayType?: DayType }
    | { date?: undefined; dayType: DayType }
);

/**
 * 6.2 응답 data
 *
 * - supported=false(데이터 없음, 그 노선에 없는 방향 등)는 오류가 아닌 정상 응답이고 pct·level·levelLabel·source 가 null 이에요.
 * - 출처 필드 이름은 6.2 가 source, 6.1 이 kind 예요. toCongestion 이 둘 다 받아요.
 */
export type CongestionResponse = {
    stationId: number;
    lineId: number;
    direction: DirectionCode;
    /** 영업일 기준 요일 구분 */
    dayType: DayType;
    /** 조회한 30분 칸의 시작 시각 (05:30 ~ 00:30) */
    slotStart: string;
    /** 조회한 영업일 날짜(yyyy-MM-dd). 요청에 date 가 없으면 null */
    slotDate: string | null;
    /** 운행 시간 밖이라 첫차(05:30) 칸으로 바꿔 조회했는지 */
    firstTrain: boolean;
    supported: boolean;
    pct: number | null;
    level: CongestionLevel | null;
    levelLabel: string | null;
    source: CongestionSource | null;
    /** 6.1 과 같은 모양의 데이터를 넘길 때만 써요. */
    kind?: CongestionSource | null;
};

/** 혼잡도를 어느 시간대 기준으로 조회했는지 (6.1 stations[], 6.2 응답 공통) */
export type CongestionSlot = {
    slotStart: string;
    slotDate: string | null;
    firstTrain: boolean;
};

/** 6.2 응답을 6.1 과 같은 congestion 모양으로 바꿔요. 단계·라벨은 서버 값을 그대로 써요(pct 로 다시 계산하지 않아요). */
export function toCongestion(
    data: Pick<CongestionResponse, 'supported' | 'pct' | 'level' | 'levelLabel'>
        & Partial<Pick<CongestionResponse, 'kind' | 'source'>>,
): Congestion {
    const supported = data.supported;
    return {
        supported,
        kind: supported ? data.kind ?? data.source ?? null : null,
        pct: supported ? data.pct : null,
        level: supported ? data.level : null,
        levelLabel: supported ? data.levelLabel : null,
    };
}
