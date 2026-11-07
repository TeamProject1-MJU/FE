/**
 * 혼잡도 서비스 (#36, API 명세 v1.12 6.2)
 *
 * TODO: 백엔드 연동 시 GET /congestion 호출로 교체합니다.
 * - 쿼리: stationId, lineId, direction, dayType, time(HH:mm), date(선택)
 * - 응답은 toCongestion() 으로 6.1 과 같은 모양으로 바꿔 화면에 넘깁니다.
 */

import type {
    CongestionQuery,
    CongestionResponse,
    CongestionSlot,
    DayType,
} from '@/types/congestion';
import type { CongestionLevel } from '@/types/route';

/** 혼잡도를 제공하는 시간대: 06:00 ~ 23:00 에 시작하는 30분 슬롯 35개 */
const FIRST_SLOT_MIN = 6 * 60;
const LAST_SLOT_MIN = 23 * 60;

const pad = (value: number) => String(value).padStart(2, '0');
const toDateString = (date: Date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function toDayType(date: Date): DayType {
    // TODO: 공휴일은 SUNDAY (서버가 공휴일 목록으로 판단)
    const day = date.getDay();
    if (day === 0) return 'SUNDAY';
    if (day === 6) return 'SATURDAY';
    return 'WEEKDAY';
}

/**
 * 시각 → 조회할 30분 슬롯 (명세 6.2 "운행일과 dayType")
 * - 06:00 전      → 같은 날 06:00 슬롯, firstTrain: true
 * - 23:30 이후    → 다음 날 06:00 슬롯, firstTrain: true (dayType 도 다음 날)
 * - 그 밖         → 시각이 속한 30분 구간
 *
 * 서버가 계산해 내려주는 값이라 실제 연동 후에는 mock 에서만 씁니다.
 */
export function resolveSlot(at: Date): CongestionSlot & { dayType: DayType } {
    const minutes = at.getHours() * 60 + at.getMinutes();

    if (minutes < FIRST_SLOT_MIN || minutes >= LAST_SLOT_MIN + 30) {
        const slotDay = new Date(at);
        if (minutes >= FIRST_SLOT_MIN) slotDay.setDate(slotDay.getDate() + 1);
        return {
            slotStart: '06:00',
            slotDate: toDateString(slotDay),
            firstTrain: true,
            dayType: toDayType(slotDay),
        };
    }

    const slot = Math.floor(minutes / 30) * 30;
    return {
        slotStart: `${pad(Math.floor(slot / 60))}:${pad(slot % 60)}`,
        slotDate: toDateString(at),
        firstTrain: false,
        dayType: toDayType(at),
    };
}

/* ---------- mock ---------- */

const MOCK_DELAY_MS = 500;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const LEVELS: { level: CongestionLevel; label: string; pct: number }[] = [
    { level: 'COMFORTABLE', label: '쾌적', pct: 28 },
    { level: 'RELAXED', label: '여유', pct: 42 },
    { level: 'NORMAL', label: '보통', pct: 78 },
    { level: 'CROWDED', label: '혼잡', pct: 118 },
    { level: 'VERY_CROWDED', label: '매우 혼잡', pct: 162 },
];

/** 혼잡도 데이터가 없는 역 (mock) */
const UNSUPPORTED_STATION_IDS = new Set([109]);

export async function fetchCongestion(query: CongestionQuery): Promise<CongestionResponse> {
    await wait(MOCK_DELAY_MS);

    const [hour, minute] = query.time.split(':').map(Number);
    const at = query.date ? new Date(`${query.date}T00:00:00`) : new Date();
    at.setHours(hour, minute, 0, 0);
    const slot = resolveSlot(at);

    const base = {
        stationId: query.stationId,
        lineId: query.lineId,
        direction: query.direction,
        dayType: slot.firstTrain ? slot.dayType : query.dayType,
        slotStart: slot.slotStart,
        // 6.2 예시: 첫차가 아니면 null
        slotDate: slot.firstTrain ? slot.slotDate : null,
        firstTrain: slot.firstTrain,
    };

    if (UNSUPPORTED_STATION_IDS.has(query.stationId)) {
        return { ...base, supported: false, pct: null, level: null, levelLabel: null, source: null };
    }

    // 출퇴근 시간대일수록 붐비게 보이도록 만든 예시 값
    const slotHour = Number(slot.slotStart.slice(0, 2));
    const rush = (slotHour >= 7 && slotHour <= 9) || (slotHour >= 18 && slotHour <= 19) ? 2 : 0;
    const index = Math.min((query.stationId + query.lineId + rush) % 3 + rush, LEVELS.length - 1);
    const picked = LEVELS[index];

    return {
        ...base,
        supported: true,
        pct: picked.pct,
        level: picked.level,
        levelLabel: picked.label,
        source: 'MOCK',
    };
}