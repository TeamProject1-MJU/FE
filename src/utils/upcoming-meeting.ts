import { formatAppointmentParam } from '@/constants/home-mock';
import type { RoomSummary } from '@/types/room';

/** 홈 "다가오는 약속" 카드에 보여줄 값 (#102). mock 의 HOME_UPCOMING_MEETING 과 같은 모양이에요. */
export type HomeMeetingCard = {
    roomId: string;
    title: string;
    appointmentAt: Date;
    /** 약속역(확정 전이면 null → "약속역 미정") */
    stationName: string | null;
    memberCount: number;
    maxMembers: number;
};

/**
 * 다가오는 약속 고르기 (#102)
 * - 약속 시각이 없는 방, 읽을 수 없는 시각, 이미 지난 방(now 보다 이른 시각)은 빼요.
 * - 남은 방 중 약속 시각이 가장 가까운 방 하나를 돌려줘요. 같은 시각이면 목록 순서가 앞선 방이에요.
 * - 남은 방이 없으면 null 이에요(빈 상태).
 */
export function pickUpcomingRoom(rooms: readonly RoomSummary[], now: Date = new Date()): RoomSummary | null {
    let best: RoomSummary | null = null;
    let bestTime = Infinity;
    for (const room of rooms) {
        if (!room.appointmentAt) continue;
        const time = Date.parse(room.appointmentAt);
        if (!Number.isFinite(time) || time < now.getTime()) continue;
        if (time < bestTime) {
            best = room;
            bestTime = time;
        }
    }
    return best;
}

/** 서버 방 목록(7.3) 항목 → 홈 카드 값. 약속 시각이 있는 방(pickUpcomingRoom 결과)만 넘겨요. */
export function toHomeMeeting(room: RoomSummary): HomeMeetingCard {
    return {
        roomId: room.id,
        title: room.name,
        appointmentAt: new Date(room.appointmentAt!),
        stationName: room.selectedStation?.name ?? null,
        memberCount: room.memberCount,
        maxMembers: room.maxMembers,
    };
}

/** 카드를 눌렀을 때 방 상세로 넘기는 params. 약속방 목록(rooms/index.tsx)의 openRoom 과 같은 모양이에요. */
export function meetingRoomParams(meeting: HomeMeetingCard) {
    return {
        roomId: meeting.roomId,
        roomName: meeting.title,
        appointmentAt: formatAppointmentParam(meeting.appointmentAt),
        maxMembers: String(meeting.maxMembers),
    };
}
