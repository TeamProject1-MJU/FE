/**
 * 서비스 기준 시간대(Asia/Seoul, UTC+9, 일광절약시간 없음) 시각 표시 (#153)
 *
 * 기기 시간대와 상관없이 응답 시각(+09:00 오프셋 등)을 서울 시각으로 보여줘요.
 * Date#getHours 대신 UTC 값에 9시간을 더해 읽어서, 기기 시간대를 바꿔도 같은 결과예요.
 * 값이 없거나 형식이 틀리면 빈 문자열·null 이에요(0시나 현재 시각으로 만들지 않아요).
 */
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad = (value: number) => String(value).padStart(2, '0');

function seoul(iso: string | null | undefined) {
    if (!iso) return null;
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return null;
    const date = new Date(time + SEOUL_OFFSET_MS);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

/** "18:38" */
export function formatSeoulTime(iso: string | null | undefined) {
    const parts = seoul(iso);
    return parts ? `${pad(parts.hour)}:${pad(parts.minute)}` : '';
}

/** "10.02" (기존 formatMonthDay 와 같은 모양) */
export function formatSeoulMonthDay(iso: string | null | undefined) {
    const parts = seoul(iso);
    return parts ? `${pad(parts.month)}.${pad(parts.day)}` : '';
}

/** 서울 기준 달력 날짜 "2026-10-02" */
export function seoulDateKey(iso: string | null | undefined) {
    const parts = seoul(iso);
    return parts ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` : null;
}

/** 서울 기준 시(0~23). mock 혼잡도처럼 시간대가 필요한 계산에 써요. */
export function seoulHour(iso: string | null | undefined) {
    return seoul(iso)?.hour ?? null;
}

/**
 * 출발·도착 표시.
 * - departure: "18:38", 약속 날짜(서울)와 다른 날 출발이면 "10.01 23:50"
 * - arrival: 도착 시각이 없으면 null(만들어 내지 않아요). 출발과 서울 날짜가 다르면 "다음 날 00:20"
 */
export function formatTripTimes(departureAt: string, arriveAt: string | null, appointmentAt: string | null) {
    const departureTime = formatSeoulTime(departureAt);
    const otherDay = !!appointmentAt && seoulDateKey(appointmentAt) !== null && seoulDateKey(departureAt) !== seoulDateKey(appointmentAt);
    const departure = departureTime && otherDay ? `${formatSeoulMonthDay(departureAt)} ${departureTime}` : departureTime;
    const arrivalTime = formatSeoulTime(arriveAt);
    const nextDay = !!arrivalTime && seoulDateKey(arriveAt) !== seoulDateKey(departureAt);
    return { departure, arrival: arrivalTime ? `${nextDay ? '다음 날 ' : ''}${arrivalTime}` : null, nextDay };
}
