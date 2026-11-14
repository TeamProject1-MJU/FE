import type { RouteSearchOptions, RouteTimeSelection } from '@/types/route';

const DAY_MS = 86400000;
const SEOUL_OFFSET_MS = 9 * 3600000;
/** BE 기본 설정과 같은 서울 날짜 기준 상한이에요. 서버가 더 짧게 설정한 범위는 서버 검증을 따라요. */
export const ARRIVAL_MAX_DAYS = 365;

export function seoulDateTime(value: number | string = Date.now()) {
    const time = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(time)) return null;
    const date = new Date(time + SEOUL_OFFSET_MS);
    if (!Number.isFinite(date.getTime())) return null;
    return { date: date.toISOString().slice(0, 10), time: date.toISOString().slice(11, 16) };
}

export function arrivalLastDate(now = Date.now()) {
    return seoulDateTime(now + ARRIVAL_MAX_DAYS * DAY_MS)!.date;
}

/** 기기 시간대와 관계없이 입력을 한국 시각으로 보내고, 2월 30일 같은 값은 보정하지 않아요. */
export function toRouteTimeInstant(date: string, time: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
    const iso = `${date}T${time}:00+09:00`;
    const parsed = seoulDateTime(iso);
    return parsed?.date === date && parsed.time === time ? iso : null;
}

export function routeTimeOptions(selection: RouteTimeSelection): Pick<RouteSearchOptions, 'departAt' | 'arriveAt'> {
    if (selection.mode === 'departure') return { departAt: selection.at };
    if (selection.mode === 'arrival') return { arriveAt: selection.at };
    return {};
}

export function validateRouteTimeOptions(options: RouteSearchOptions, now = Date.now()): string | null {
    if (options.departAt !== undefined && options.arriveAt !== undefined) return '출발 시각과 도착 시각 중 하나만 지정해 주세요.';
    for (const value of [options.departAt, options.arriveAt]) {
        if (value === undefined) continue;
        const parts = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value) : null;
        const valid = parts && Number.isFinite(Date.parse(value!)) && Number(parts[2]) < 24 && Number(parts[3]) < 60
            && Number(parts[4] ?? 0) < 60 && (parts[5] === 'Z' || Number(parts[6]) <= 18 && Number(parts[7]) < 60 && (Number(parts[6]) !== 18 || Number(parts[7]) === 0))
            && new Date(`${parts[1]}T00:00:00Z`).toISOString().slice(0, 10) === parts[1];
        if (!valid) return '시간대를 포함한 올바른 날짜와 시각을 선택해 주세요.';
    }
    // BE는 지난 departAt도 그대로 받아요. arriveAt만 초 단위의 현재 시각과 서울 날짜 상한으로 검사해요.
    if (options.arriveAt !== undefined) {
        if (Math.floor(Date.parse(options.arriveAt) / 1000) < Math.floor(now / 1000)) return '도착 시각은 현재 이후로 선택해 주세요.';
        if (seoulDateTime(options.arriveAt)!.date > arrivalLastDate(now)) return `도착 날짜는 한국 날짜 기준 ${arrivalLastDate(now)}까지 선택해 주세요.`;
    }
    return null;
}

export function formatRouteDateTime(iso: string) {
    const parts = seoulDateTime(iso);
    return parts ? `${parts.date.replace(/-/g, '.')} ${parts.time}` : '';
}

export function formatRouteTimeSelection(selection: RouteTimeSelection) {
    return selection.mode === 'now' ? '지금 출발'
        : `${formatRouteDateTime(selection.at)}${selection.mode === 'departure' ? ' 출발' : '까지 도착'}`;
}

export function formatArrivalSlack(seconds: number) {
    if (seconds === 0) return '지정한 도착 시각에 도착해요.';
    const duration = [seconds >= 60 ? `${Math.floor(seconds / 60)}분` : '', seconds % 60 ? `${seconds % 60}초` : ''].filter(Boolean).join(' ');
    return `지정한 도착 시각보다 ${duration} 일찍 도착해요.`;
}
