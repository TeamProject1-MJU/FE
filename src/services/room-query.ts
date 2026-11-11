import { get, post } from '@/services/api/client';
import { ApiError, isAuthError } from '@/services/api/errors';
import { getSessionGeneration } from '@/services/auth';
import { fetchMe } from '@/services/user';
import { getAuthStatus, getSession } from '@/stores/auth-store';
import { assertRoomCacheScope, cacheCreatedRoom, cacheJoinedRoom, findCachedRoomIdByCode, cacheRoomDetail, cacheRoomList, cacheRoomMembers, getRoomCacheScope, removeCachedRoom } from '@/services/room-cache';
import { RoomError, type CreateRoomRequest, type CreatedRoom, type RoomDetail, type RoomErrorCode, type RoomMember, type RoomStation, type RoomSummary } from '@/types/room';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isRole = (value: unknown) => value === 'OWNER' || value === 'MEMBER';
const invalid = (): never => { throw new ApiError('UNKNOWN_ERROR'); };

function parseRoomStation(value: unknown): RoomStation | null {
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
                if (version === writeVersion && roomId && error instanceof ApiError && ['ROOM_NOT_FOUND', 'NOT_ROOM_MEMBER'].includes(error.code)) removeCachedRoom(roomId, scope);
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
