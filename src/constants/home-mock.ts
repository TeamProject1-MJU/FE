/**
 * 홈 화면 mock 데이터 (#32)
 *
 * 실제 API(사용자 정보, 내 약속방 목록) 연동 전까지 홈 화면에서만 사용합니다.
 * API 연동 시 이 파일 대신 services 의 응답으로 교체합니다.
 */

export type HomeUpcomingMeeting = {
    roomId: string;
    title: string;
    /** 약속 일시 */
    appointmentAt: Date;
    /** 약속역 (확정 전이면 null) */
    stationName: string | null;
    memberCount: number;
    maxMembers: 2 | 3 | 4;
};

/** 시연 날짜와 상관없이 항상 'D-3' 으로 보이도록 오늘 기준으로 날짜를 만듭니다. */
function daysFromToday(days: number, hour: number, minute = 0) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(hour, minute, 0, 0);
    return date;
}

export const HOME_UPCOMING_MEETING: HomeUpcomingMeeting | null = {
    roomId: 'preview',
    title: '주말 저녁 모임',
    appointmentAt: daysFromToday(3, 18),
    stationName: '시청',
    memberCount: 3,
    maxMembers: 4,
};

const pad = (value: number) => String(value).padStart(2, '0');

/** 오늘 기준 D-day 라벨 (D-3, D-DAY, D+1) */
export function formatDday(target: Date, now = new Date()) {
    const startOf = (d: Date) =>
        new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((startOf(target) - startOf(now)) / 86_400_000);

    if (diff === 0) return 'D-DAY';
    return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

/** 11.07 */
export function formatMonthDay(date: Date) {
    return `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

/** 18:00 */
export function formatTime(date: Date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 약속방 상세 화면 params 형식 (2026-11-07 18:00) */
export function formatAppointmentParam(date: Date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatTime(date)}`;
}