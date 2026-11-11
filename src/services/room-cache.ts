import { ApiError } from '@/services/api/errors';
import { getSessionGeneration } from '@/services/auth';
import { getAuthStatus, getSession } from '@/stores/auth-store';
import type { CreatedRoom, RoomDetail, RoomMember, RoomStation, RoomSummary } from '@/types/room';

/** 서버에서 확인한 방 정보만 보관해요. mock 방을 섞거나 디스크에 저장하지 않아요. */
type Entry = { summary?: RoomSummary; detail?: RoomDetail; members?: RoomMember[]; roomCode?: string };
const entries = new Map<string, Entry>();
let listIds: string[] = [];
let scope: string | null = null;
const resetListeners = new Set<() => void>();

function syncScope() {
    const userId = getSession()?.userId;
    const next = getAuthStatus() === 'signedIn' && userId ? `${getSessionGeneration()}:${userId}` : null;
    if (next !== scope) {
        entries.clear();
        listIds = [];
        scope = next;
        resetListeners.forEach(listener => listener());
    }
    return next;
}

/** 계정·로그인 세대가 바뀌면 후보·채팅·추천의 임시 메모리도 분리해요. */
export function subscribeRoomCacheReset(listener: () => void) {
    resetListeners.add(listener);
    return () => { resetListeners.delete(listener); };
}

export function getRoomCacheScope(): string {
    const current = syncScope();
    if (!current) throw new ApiError('AUTH_REQUIRED');
    return current;
}

export function assertRoomCacheScope(expected: string) {
    if (syncScope() !== expected) throw new ApiError('AUTH_REQUIRED');
}

const cloneStation = (station: RoomStation | null): RoomStation | null => station
    ? { ...station, lines: station.lines.map(line => ({ ...line })) } : null;
const cloneMembers = (members: RoomMember[]) => members.map(member => ({ ...member, departureStation: cloneStation(member.departureStation) }));
const cloneSummary = (room: RoomSummary): RoomSummary => ({
    id: room.id, name: room.name, status: room.status, myRole: room.myRole,
    memberCount: room.memberCount, maxMembers: room.maxMembers,
    appointmentAt: room.appointmentAt, selectedStation: cloneStation(room.selectedStation),
});
const cloneDetail = (room: RoomDetail): RoomDetail => ({ ...cloneSummary(room), ownerId: room.ownerId, confirmedAt: room.confirmedAt, members: cloneMembers(room.members) });

export function readCachedRooms(): RoomSummary[] {
    syncScope();
    return listIds.flatMap(id => { const room = entries.get(id)?.summary; return room ? [cloneSummary(room)] : []; });
}

export function readCachedRoom(roomId: string): RoomSummary | undefined {
    syncScope();
    const room = entries.get(roomId)?.summary;
    return room ? cloneSummary(room) : undefined;
}

export function readCachedRoomDetail(roomId: string): RoomDetail | undefined {
    syncScope();
    const detail = entries.get(roomId)?.detail;
    return detail ? cloneDetail(detail) : undefined;
}

export function readCachedMembers(roomId: string): RoomMember[] {
    syncScope();
    return cloneMembers(entries.get(roomId)?.members ?? []);
}

export function cacheRoomList(rooms: RoomSummary[], expected: string) {
    assertRoomCacheScope(expected);
    const ids = new Set(rooms.map(room => room.id));
    for (const id of entries.keys()) if (!ids.has(id)) entries.delete(id);
    listIds = rooms.map(room => room.id);
    for (const room of rooms) {
        const previous = entries.get(room.id);
        // 인원·내 역할이 바뀐 목록이면 예전 멤버와 권한을 재사용하지 않아요.
        const keepMembers = previous?.members?.length === room.memberCount
            && previous.members.find(member => member.userId === getSession()?.userId)?.role === room.myRole;
        entries.set(room.id, {
            summary: cloneSummary(room),
            ...(previous?.roomCode ? { roomCode: previous.roomCode } : {}),
            ...(keepMembers && previous?.detail ? { detail: { ...previous.detail, ...cloneSummary(room) } } : {}),
            ...(keepMembers && previous?.members ? { members: previous.members } : {}),
        });
    }
}

export function cacheRoomDetail(room: RoomDetail, expected: string) {
    assertRoomCacheScope(expected);
    const detail = cloneDetail(room);
    const roomCode = entries.get(room.id)?.roomCode;
    entries.set(room.id, { summary: cloneSummary(room), detail, members: cloneMembers(room.members), ...(roomCode ? { roomCode } : {}) });
    if (!listIds.includes(room.id)) listIds.push(room.id);
}

export function cacheRoomMembers(roomId: string, members: RoomMember[], expected: string) {
    assertRoomCacheScope(expected);
    const previous = entries.get(roomId);
    const mine = members.find(member => member.userId === getSession()?.userId);
    const owner = members.find(member => member.role === 'OWNER');
    if (!mine || !owner) throw new ApiError('UNKNOWN_ERROR');
    if (!previous?.summary) {
        entries.set(roomId, { ...previous, members: cloneMembers(members) });
        return; // 멤버는 보관하되 상세·목록에 없는 가짜 방 정보를 만들지 않아요.
    }
    const summary = { ...previous.summary, memberCount: members.length, myRole: mine.role };
    entries.set(roomId, {
        ...(previous.roomCode ? { roomCode: previous.roomCode } : {}),
        summary,
        members: cloneMembers(members),
        ...(previous.detail ? { detail: { ...previous.detail, ...summary, ownerId: owner.userId, members: cloneMembers(members) } } : {}),
    });
}

/** 서버가 403·404로 거절한 방은 이전 조회값으로 다시 보여주지 않아요. */
export function removeCachedRoom(roomId: string, expected: string) {
    assertRoomCacheScope(expected);
    entries.delete(roomId);
    listIds = listIds.filter(id => id !== roomId);
}


/** 7.1이 보장하는 생성 직후 요약만 추가해요. 가입 시각이나 멤버 상세는 만들지 않아요. */
export function cacheCreatedRoom(room: CreatedRoom, expected: string) {
    assertRoomCacheScope(expected);
    entries.set(room.id, { summary: cloneSummary(room), roomCode: room.roomCode });
    if (!listIds.includes(room.id)) listIds.push(room.id);
}

/** 참여 후 인원·역할은 7.4로 다시 받아요. 이전 상세를 새 참여 결과로 재사용하지 않아요. */
export function cacheJoinedRoom(roomId: string, roomCode: string, expected: string) {
    assertRoomCacheScope(expected);
    entries.set(roomId, { roomCode });
    listIds = listIds.filter(id => id !== roomId);
}

/** 서버에서 확인한 초대 코드예요. 현재 OWNER인 캐시에서만 읽어요. */
export function readCachedRoomCode(roomId: string): string | undefined {
    syncScope();
    const entry = entries.get(roomId);
    return entry?.summary?.myRole === 'OWNER' ? entry.roomCode : undefined;
}

export function findCachedRoomIdByCode(roomCode: string): string | undefined {
    syncScope();
    return [...entries].find(([, entry]) => entry.roomCode === roomCode)?.[0];
}


export function cacheRoomInviteCode(roomId: string, roomCode: string, expected: string) {
    assertRoomCacheScope(expected);
    entries.set(roomId, { ...entries.get(roomId), roomCode });
}

export function clearCachedRoomCode(roomId: string, expected: string) {
    assertRoomCacheScope(expected);
    const entry = entries.get(roomId);
    if (entry) delete entry.roomCode;
}
