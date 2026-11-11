import { ApiError } from '@/services/api/errors';
import { getSessionGeneration } from '@/services/auth';
import { getAuthStatus, getSession } from '@/stores/auth-store';
import type { RoomDetail, RoomMember, RoomStation, RoomSummary } from '@/types/room';

/** 서버에서 확인한 방 정보만 보관해요. mock 방을 섞거나 디스크에 저장하지 않아요. */
type Entry = { summary?: RoomSummary; detail?: RoomDetail; members?: RoomMember[] };
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
            ...(keepMembers && previous?.detail ? { detail: { ...previous.detail, ...cloneSummary(room) } } : {}),
            ...(keepMembers && previous?.members ? { members: previous.members } : {}),
        });
    }
}

export function cacheRoomDetail(room: RoomDetail, expected: string) {
    assertRoomCacheScope(expected);
    const detail = cloneDetail(room);
    entries.set(room.id, { summary: cloneSummary(room), detail, members: cloneMembers(room.members) });
}

export function cacheRoomMembers(roomId: string, members: RoomMember[], expected: string) {
    assertRoomCacheScope(expected);
    const previous = entries.get(roomId);
    const mine = members.find(member => member.userId === getSession()?.userId);
    const owner = members.find(member => member.role === 'OWNER');
    if (!mine || !owner) throw new ApiError('UNKNOWN_ERROR');
    if (!previous?.summary) {
        entries.set(roomId, { members: cloneMembers(members) });
        return; // 멤버는 보관하되 상세·목록에 없는 가짜 방 정보를 만들지 않아요.
    }
    const summary = { ...previous.summary, memberCount: members.length, myRole: mine.role };
    entries.set(roomId, {
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
