import { seoulDateTime } from '@/utils/route-time';

const DAY_MS = 86400000;

// 표시만 해요. 상태값(YYYY-MM-DD, HH:MM)은 그대로 두고 시안 형식으로 보여 줘요.
export function dayLabel(date: string) {
    if (date === seoulDateTime()?.date) return '오늘';
    if (date === seoulDateTime(Date.now() + DAY_MS)?.date) return '내일';
    const [, month, day] = date.split('-').map(Number);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (!month || !day || Number.isNaN(weekday)) return date;
    return `${month}월 ${day}일(${'일월화수목금토'[weekday]})`;
}

/** HH:MM(24시간)을 오전/오후(0/1)·시(1~12)·분으로 나눠요. 읽을 수 없으면 null 이에요. */
export function toTwelveHour(time: string) {
    const match = /^(\d{2}):(\d{2})$/.exec(time);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return { pm: hour >= 12, hour: hour % 12 || 12, minute };
}

/** 오전 12시 = 00시, 오후 12시 = 12시로 HH:MM 을 만들어요. */
export function fromTwelveHour(pm: boolean, hour: number, minute: number) {
    const hour24 = (hour % 12) + (pm ? 12 : 0);
    return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 선택값 줄에 쓰는 "오후 7:30" 형식이에요. */
export function timeLabel(time: string) {
    const parts = toTwelveHour(time);
    return parts ? `${parts.pm ? '오후' : '오전'} ${parts.hour}:${String(parts.minute).padStart(2, '0')}` : '';
}

/** minDate 부터 maxDate 까지 하루씩 늘어놓아요(서울 날짜 문자열 기준). */
export function dateRange(minDate: string, maxDate: string) {
    const dates: string[] = [];
    const start = Date.parse(`${minDate}T00:00:00Z`);
    const end = Date.parse(`${maxDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return dates;
    for (let at = start; at <= end; at += DAY_MS) dates.push(new Date(at).toISOString().slice(0, 10));
    return dates;
}
