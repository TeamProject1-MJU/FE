import { get, post, patch, put, delete as apiDelete } from '@/services/api/client';
import { ApiError, isAuthError } from '@/services/api/errors';
import { getSessionGeneration } from '@/services/auth';
import { fetchMe } from '@/services/user';
import { getAuthStatus, getSession } from '@/stores/auth-store';
import { assertRoomCacheScope, cacheRoomInviteCode, clearCachedRoomCode, cacheCreatedRoom, cacheJoinedRoom, findCachedRoomIdByCode, cacheRoomDetail, cacheRoomList, cacheRoomMembers, getRoomCacheScope, removeCachedRoom } from '@/services/room-cache';
import { RoomError, type CreateRoomRequest, type CreatedRoom, type LeaveRoomResult, type RoomDetail, type RoomErrorCode, type RoomMember, type RoomStation, type RoomSummary } from '@/types/room';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isRole = (value: unknown) => value === 'OWNER' || value === 'MEMBER';
const invalid = (): never => { throw new ApiError('UNKNOWN_ERROR'); };

export function parseRoomStation(value: unknown): RoomStation | null {
    if (value === null) return null;
    if (!isRecord(value) || !isNumber(value.id) || typeof value.name !== 'string' || typeof value.isSupported !== 'boolean'
        || !Array.isArray(value.lines) || !value.lines.every(line => isRecord(line) && isNumber(line.lineId)
            && typeof line.lineName === 'string' && typeof line.color === 'string')) return invalid();
    return { id: value.id, name: value.name, isSupported: value.isSupported, lines: value.lines.map(line => ({ ...line })) };
}

function parseSummary(value: unknown): RoomSummary {
    if (!isRecord(value) || !isId(value.id) || typeof value.name !== 'string'
        || !(value.status === 'OPEN' || value.status === 'CONFIRMED') || !isRole(value.myRole)
        || !Number.isInteger(value.memberCount) || !Number.isInteger(value.maxMembers)
        || !(value.appointmentAt === null || isDate(value.appointmentAt))) return invalid();
    return { ...value, selectedStation: parseRoomStation(value.selectedStation) } as RoomSummary;
}

function parseMembers(value: unknown): RoomMember[] {
    if (!Array.isArray(value)) return invalid();
    const members = value.map(member => {
        if (!isRecord(member) || !isId(member.userId) || typeof member.nickname !== 'string'
            || !isRole(member.role) || !isDate(member.joinedAt)) return invalid();
        return { ...member, departureStation: parseRoomStation(member.departureStation) } as RoomMember;
    });
    if (new Set(members.map(member => member.userId)).size !== members.length
        || members.filter(member => member.role === 'OWNER').length !== 1
        || !members.some(member => member.userId === getSession()?.userId)) return invalid();
    return members;
}

function parseList(value: unknown): RoomSummary[] {
    if (!Array.isArray(value)) return invalid();
    const rooms = value.map(parseSummary);
    if (new Set(rooms.map(room => room.id)).size !== rooms.length) return invalid();
    return rooms;
}

function parseDetail(value: unknown, roomId: string): RoomDetail {
    if (!isRecord(value)) return invalid();
    const members = parseMembers(value.members);
    // 7.4 실서버 상세는 memberCount 없이 전체 members를 내려줘요. 목록의 필수 검사는 유지해요.
    if (Object.prototype.hasOwnProperty.call(value, 'memberCount')
        && (!Number.isInteger(value.memberCount) || value.memberCount !== members.length)) return invalid();
    const summary = parseSummary({ ...value, memberCount: members.length });
    if (summary.id !== roomId || !isId(value.ownerId)
        || !(value.confirmedAt === null || isDate(value.confirmedAt))) return invalid();
    if (members.find(member => member.role === 'OWNER')?.userId !== value.ownerId
        || members.find(member => member.userId === getSession()?.userId)?.role !== summary.myRole) return invalid();
    return { ...summary, ownerId: value.ownerId, confirmedAt: value.confirmedAt, members };
}

let profileRequest: { generation: number; promise: Promise<unknown> } | null = null;
async function ensureUser() {
    const generation = getSessionGeneration();
    if (getAuthStatus() !== 'signedIn') throw new ApiError('AUTH_REQUIRED');
    // Refresh Token 복원 직후에는 사용자 ID가 null이에요. 기존 4.4 서비스로 한 번 확인해요.
    if (!getSession()?.userId) {
        if (!profileRequest || profileRequest.generation !== generation) {
            const promise = fetchMe();
            profileRequest = { generation, promise };
            void promise.finally(() => { if (profileRequest?.promise === promise) profileRequest = null; }).catch(() => {});
        }
        await profileRequest.promise;
    }
    if (generation !== getSessionGeneration()) throw new ApiError('AUTH_REQUIRED');
    return getRoomCacheScope();
}

function mapRoomError(error: unknown): never {
    if (error instanceof RoomError) throw error;
    if (error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error))) throw error;
    const messages = {
        NOT_ROOM_OWNER: '방장만 변경하거나 초대 코드를 볼 수 있어요. 방장이 바뀌었는지 확인해 주세요.',
        STATION_NOT_FOUND: '선택한 역을 찾을 수 없어요. 다른 역을 선택해 주세요.',
        STATION_UNSUPPORTED: '아직 지원하지 않는 역이에요. 다른 출발역을 선택해 주세요.',
        ROOM_CODE_INVALID: '없는 초대 코드예요. 코드를 다시 확인해 주세요.',
        ROOM_FULL: '정원(4명)이 다 찬 약속방이에요.',
        ALREADY_JOINED: '이미 참여 중인 약속방이에요.',
        ROOM_NOT_FOUND: '약속방을 찾을 수 없어요.',
        NOT_ROOM_MEMBER: '참여하지 않은 약속방이에요.',
        NETWORK_ERROR: '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
        VALIDATION_ERROR: '요청한 방 정보를 확인해 주세요.',
        ROOM_BUSY: '다른 요청을 처리하고 있어요. 잠시 후 다시 시도해 주세요.',
        UNKNOWN_ERROR: '서버의 방 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
    };
    const code = error instanceof ApiError && Object.prototype.hasOwnProperty.call(messages, error.code)
        ? error.code as keyof typeof messages : 'UNKNOWN_ERROR';
    throw new RoomError(code as RoomErrorCode, messages[code]);
}

/** 채팅과 상세 화면의 동시 조회는 같은 요청을 공유해요. 별도 재시도는 추가하지 않아요. */
const pending = new Map<string, Promise<unknown>>();
// 생성·참여 전의 조회가 새 캐시를 덮거나, 참여 후 조회가 이전 요청을 공유하지 않도록 해요.
let writeVersion = 0;
async function query<T>(path: string, parse: (raw: unknown) => T, save: (value: T, scope: string) => void, roomId?: string): Promise<T> {
    try {
        const scope = await ensureUser();
        const version = writeVersion;
        const key = `${scope}:${version}:${path}`;
        const previous = pending.get(key);
        if (previous) return await previous as T;
        const request = (async () => {
            try {
                const raw = await get<unknown>(path);
                assertRoomCacheScope(scope);
                const value = parse(raw);
                if (version === writeVersion) save(value, scope);
                return value;
            } catch (error) {
                // A-1이 이미 로그아웃했어도 원래 TOKEN_* 코드를 보존해요.
                if (error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error))) throw error;
                assertRoomCacheScope(scope);
                if (version === writeVersion && roomId && error instanceof ApiError) {
                    if (['ROOM_NOT_FOUND', 'NOT_ROOM_MEMBER'].includes(error.code)) removeCachedRoom(roomId, scope);
                    else if (error.code === 'NOT_ROOM_OWNER') clearCachedRoomCode(roomId, scope);
                }
                throw error;
            }
        })();
        pending.set(key, request);
        try { return await request; }
        finally { if (pending.get(key) === request) pending.delete(key); }
    } catch (error) { return mapRoomError(error); }
}

export const fetchServerRooms = () => query('/rooms', parseList, cacheRoomList);
export const fetchServerRoomDetail = (roomId: string) => query(`/rooms/${encodeURIComponent(roomId)}`, raw => parseDetail(raw, roomId), cacheRoomDetail, roomId);
export const fetchServerRoomMembers = (roomId: string) => query(`/rooms/${encodeURIComponent(roomId)}/members`, parseMembers, (members, scope) => cacheRoomMembers(roomId, members, scope), roomId);


const isZonedDate = (value: unknown): value is string => isDate(value)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);

/** 7.1은 목록·상세와 다른 응답이에요. 없는 세 필드만 생성 규칙에 따라 채워요. */
function parseCreated(value: unknown): CreatedRoom {
    if (!isRecord(value) || !isId(value.id) || !isId(value.ownerId) || value.ownerId !== getSession()?.userId
        || typeof value.roomCode !== 'string' || !/^[A-Z0-9]{6}$/.test(value.roomCode)
        || typeof value.name !== 'string' || !value.name.trim() || Array.from(value.name).length > 30
        || value.maxMembers !== 4 || !(value.status === 'OPEN' || value.status === 'CONFIRMED')
        || !(value.appointmentAt === null || isZonedDate(value.appointmentAt))) return invalid();
    return {
        id: value.id, roomCode: value.roomCode, name: value.name, maxMembers: value.maxMembers,
        status: value.status, ownerId: value.ownerId, appointmentAt: value.appointmentAt,
        myRole: 'OWNER', memberCount: 1, selectedStation: null,
    };
}

async function postRoom(path: string, body: unknown, scope: string): Promise<unknown> {
    try { return await post<unknown>(path, body); }
    catch (error) {
        if (error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error))) throw error;
        assertRoomCacheScope(scope);
        throw error;
    }
}

export async function createServerRoom(request: CreateRoomRequest): Promise<CreatedRoom> {
    try {
        const appointmentAt = request.appointmentAt ?? null;
        if (appointmentAt !== null && !isZonedDate(appointmentAt)) {
            throw new RoomError('VALIDATION_ERROR', '약속 시각은 시간대가 포함된 날짜와 시간으로 입력해 주세요.');
        }
        const scope = await ensureUser();
        const raw = await postRoom('/rooms', { name: request.name, appointmentAt }, scope);
        assertRoomCacheScope(scope);
        const room = parseCreated(raw);
        writeVersion++;
        cacheCreatedRoom(room, scope);
        return room;
    } catch (error) { return mapRoomError(error); }
}

export async function joinServerRoom(roomCode: string): Promise<{ roomId: string }> {
    try {
        const scope = await ensureUser();
        let raw: unknown;
        try {
            raw = await postRoom('/rooms/join', { roomCode }, scope);
        } catch (error) {
            if (error instanceof ApiError && error.code === 'ALREADY_JOINED') {
                assertRoomCacheScope(scope);
                const roomId = isRecord(error.details) && isId(error.details.roomId)
                    ? error.details.roomId : findCachedRoomIdByCode(roomCode);
                throw new RoomError('ALREADY_JOINED', '이미 참여 중인 약속방이에요.', roomId);
            }
            throw error;
        }
        assertRoomCacheScope(scope);
        if (!isRecord(raw) || !isId(raw.roomId)) return invalid();
        const roomId = raw.roomId;
        writeVersion++;
        cacheJoinedRoom(roomId, roomCode, scope);
        try {
            await fetchServerRoomDetail(roomId);
        } catch (error) {
            if (error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error))) throw error;
            assertRoomCacheScope(scope);
            // POST는 이미 성공했어요. 조회만 실패하면 상세 화면에서 재조회하며 참여를 다시 보내지 않아요.
        }
        assertRoomCacheScope(scope);
        return { roomId };
    } catch (error) { return mapRoomError(error); }
}


/** 7.9는 캐시 역할로 미리 거절하지 않고 현재 서버 권한으로 확인해요. */
export const fetchServerInviteCode = (roomId: string): Promise<{ roomCode: string }> => query(
    `/rooms/${encodeURIComponent(roomId)}/invite-code`,
    raw => {
        if (!isRecord(raw) || typeof raw.roomCode !== 'string' || !/^[A-Z0-9]{6}$/.test(raw.roomCode)) return invalid();
        return { roomCode: raw.roomCode };
    },
    (value, scope) => cacheRoomInviteCode(roomId, value.roomCode, scope), roomId,
);

async function mutateRoom(roomId: string, suffix: string, body: unknown, reload: () => Promise<unknown>, method: 'PATCH' | 'PUT' | 'DELETE' = 'PATCH', expectedScope?: string): Promise<void> {
    try {
        const scope = await ensureUser();
        if (expectedScope) assertRoomCacheScope(expectedScope);
        try {
            const path = `/rooms/${encodeURIComponent(roomId)}${suffix}`;
            const raw = method === 'DELETE' ? await apiDelete<unknown>(path)
                : method === 'PUT' ? await put<unknown>(path, body) : await patch<unknown>(path, body);
            assertRoomCacheScope(scope);
            if (raw !== null) return invalid();
        } catch (error) {
            if (error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error))) throw error;
            assertRoomCacheScope(scope);
            if (error instanceof ApiError) {
                if (error.code === 'NOT_ROOM_MEMBER' || error.code === 'ROOM_NOT_FOUND') removeCachedRoom(roomId, scope);
                else if (error.code === 'NOT_ROOM_OWNER') clearCachedRoomCode(roomId, scope);
            }
            throw error;
        }
        writeVersion++;
        try { await reload(); }
        catch (error) {
            if (error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error))) throw error;
            assertRoomCacheScope(scope);
            if (error instanceof RoomError && (error.code === 'NETWORK_ERROR' || error.code === 'UNKNOWN_ERROR')) {
                throw new RoomError(error.code, '변경은 저장했지만 최신 정보를 불러오지 못했어요. 잠시 후 다시 조회해 주세요.');
            }
            throw error;
        }
        assertRoomCacheScope(scope);
    } catch (error) { return mapRoomError(error); }
}

export async function updateServerDeparture(roomId: string, request: { departureStationId: number }): Promise<void> {
    if (!Number.isSafeInteger(request?.departureStationId)) {
        throw new RoomError('VALIDATION_ERROR', '출발역을 다시 선택해 주세요.');
    }
    await mutateRoom(roomId, '/members/me', { departureStationId: request.departureStationId }, () => fetchServerRoomMembers(roomId));
}

export async function updateServerRoom(roomId: string, request: { name?: string; appointmentAt?: string | null }): Promise<void> {
    const body: { name?: string; appointmentAt?: string | null } = {};
    if (request.name !== undefined) body.name = request.name;
    if (request.appointmentAt !== undefined) {
        if (request.appointmentAt === null) body.appointmentAt = null;
        else {
            if (!isZonedDate(request.appointmentAt) || Date.parse(request.appointmentAt) <= Date.now()) {
                throw new RoomError('VALIDATION_ERROR', '지금 이후의 약속 시각을 시간대와 함께 입력해 주세요.');
            }
            const [year, month, day] = request.appointmentAt.slice(0, 10).split('-').map(Number);
            const calendar = new Date(Date.UTC(year, month - 1, day));
            if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
                throw new RoomError('VALIDATION_ERROR', '약속 날짜를 다시 선택해 주세요.');
            }
            body.appointmentAt = new Date(request.appointmentAt).toISOString();
        }
    }
    await mutateRoom(roomId, '', body, () => fetchServerRoomDetail(roomId));
}


/** #107: 나가기·약속역 변경을 같은 계정·방에서 동시에 보내지 않아요. */
const pendingRoomActions = new Set<string>();
async function roomAction<T>(roomId: string, action: (scope: string) => Promise<T>): Promise<T> {
    let key: string | undefined;
    try {
        const scope = await ensureUser();
        key = `${scope}:${roomId}`;
        if (pendingRoomActions.has(key)) throw new RoomError('ROOM_BUSY', '다른 요청을 처리하고 있어요. 잠시 후 다시 시도해 주세요.');
        pendingRoomActions.add(key);
        try { return await action(scope); }
        finally { pendingRoomActions.delete(key); }
    } catch (error) { return mapRoomError(error); }
}

/** 7.7: 승계·삭제 판단은 서버 값만 사용하며 재요청의 403·404도 캐시를 비워요. */
export function leaveServerRoom(roomId: string): Promise<LeaveRoomResult> {
    return roomAction(roomId, async scope => {
        let raw: unknown;
        try {
            raw = await apiDelete<unknown>(`/rooms/${encodeURIComponent(roomId)}/members/me`);
        } catch (error) {
            if (error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error))) throw error;
            assertRoomCacheScope(scope);
            if (error instanceof ApiError && (error.code === 'NOT_ROOM_MEMBER' || error.code === 'ROOM_NOT_FOUND')) {
                writeVersion++;
                removeCachedRoom(roomId, scope);
                throw new RoomError(error.code, '이미 나간 방이거나 삭제된 약속방이에요. 목록에서 현재 상태를 확인해 주세요.');
            }
            throw error;
        }
        assertRoomCacheScope(scope);
        if (!isRecord(raw) || typeof raw.roomDeleted !== 'boolean'
            || !(raw.newOwnerId === null || isId(raw.newOwnerId))
            || raw.roomDeleted && raw.newOwnerId !== null
            || raw.newOwnerId === getSession()?.userId) return invalid();
        writeVersion++;
        removeCachedRoom(roomId, scope);
        return { roomDeleted: raw.roomDeleted, newOwnerId: raw.newOwnerId };
    });
}

/** 7.10·7.11: null 성공 뒤 방 상세를 조회하고 confirmedAt도 서버 값을 사용해요. */
export function setServerSelectedStation(roomId: string, stationId: number | null): Promise<void> {
    if (stationId !== null && !Number.isSafeInteger(stationId)) {
        return Promise.reject(new RoomError('VALIDATION_ERROR', '약속역을 다시 선택해 주세요.'));
    }
    return roomAction(roomId, async scope => {
        assertRoomCacheScope(scope);
        await mutateRoom(roomId, '/selected-station', stationId === null ? undefined : { stationId },
            () => fetchServerRoomDetail(roomId), stationId === null ? 'DELETE' : 'PUT', scope);
        assertRoomCacheScope(scope);
    });
}
