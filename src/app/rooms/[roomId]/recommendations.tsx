import { formatDurationMinutes } from '@/components/route/format';
import { formatStationName } from '@/utils/station-name';
import { ApiError, isAuthError } from '@/services/api/errors';
import { useMock as isMockMode } from '@/services/api/config';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import { Text } from '@/components/app-text';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { openStationPicker, type Station } from '@/app/station-search';
import Passenger, { type PassengerTone } from '@/components/passenger';
import TrainBlock from '@/components/train-block';
import LineBadge from '@/components/route/LineBadge';
import { formatMonthDay, formatTime } from '@/constants/home-mock';
import {
    formatBoardingTrain,
    formatLeg,
    formatLegTrain,
    formatLegTransfer,
    formatSlack,
    formatTripLine,
    sourceNote,
    stalePlanText,
    staleReasonText,
} from '@/utils/recommendation-trip';
import { formatSeoulTime } from '@/utils/seoul-time';
import {
    createRecommendation,
    fetchLatestRecommendation,
    fetchRecommendation,
    listRecommendationRuns,
} from '@/services/recommendation';
import { createProposal, fetchProposals, fetchRoomDetail, getMyUserId, updateMyDeparture } from '@/services/room';
import {
    RecommendationError,
    type AppliedConstraints,
    type ParticipantTime,
    type RecommendationCriterion,
    type RecommendationResult,
    type RecommendationRun,
} from '@/types/recommendation';
import { RoomError, type RoomDetail, type RoomMember, type StationProposalList } from '@/types/room';
import { roomEventsScope, useRoomEvents } from '@/hooks/use-room-events';
import { mergeRoomUpdated, parseSelectedStationEvent, recommendationEventAction } from '@/services/room-events';
import { getRoomCacheScope, removeCachedRoom } from '@/services/room-cache';
import { ROOM_CARD_PADDING } from '@/constants/layout';

const WHITE = '#ffffff';

/* 입력 보기·계산 중·불러오기 실패 화면 라벤더 톤 (#204, design-ref 시안 07 중간역 찾기) */
const LV_BG = '#F7F5FA';
const LV_TEXT = '#25212D';
const LV_GRAY = '#83808B';
const LV_PURPLE = '#5C3F78';
const LV_SOFT = '#F0ECF5';
const LV_SEGMENT = '#EDE8F3';
const LV_CARD_BORDER = '#EEEAF2';
const LV_DIVIDER = '#F3F0F6';
const LV_FIELD_BORDER = '#E8E4ED';
const LV_TAG_BG = '#F1EEF4';
const LV_DISABLED = '#CFC6DA';
const LV_WARN = '#6F6B78';
const LV_ERROR = '#C2415B';
const LV_ERROR_SOFT = '#FBECEF';
/* 결과 보기 라벤더 톤 (#206, design-ref 시안 08 추천 중간역) */
const LV_SUBTEXT = '#4A4553';
const LV_BAR = '#B89BC7';
const LV_BAR_TRACK = '#F4F1F7';
const LV_CHIP_BORDER = '#D9CCE4';
const LV_ROW_BORDER = '#EFEBF3';
const LV_CHEVRON = '#B4AFBC';
const LV_STALE_SOFT = '#F4F1F7';
const LV_STALE_TEXT = '#6F6B78';
/** 나는 'me', 다른 참여자는 이 순서로 돌려 써요 (캐릭터 줄과 참여자 목록이 같은 색) */
const OTHER_TONES: PassengerTone[] = ['other', 'pink', 'sky', 'mint'];

const CRITERIA: { key: RecommendationCriterion; label: string; short: string; icon: 'time-outline' | 'wallet-outline' | 'map-outline' }[] = [
    { key: 'TIME', label: '시간 기준', short: '시간', icon: 'time-outline' },
    { key: 'FARE', label: '요금 기준', short: '요금', icon: 'wallet-outline' },
    { key: 'DISTANCE', label: '거리 기준', short: '거리', icon: 'map-outline' },
];

const CONGESTION_COLOR: Record<string, string> = { COMFORTABLE: '#2bcf9a', RELAXED: '#8fd14f', NORMAL: '#f2b705', CROWDED: '#f28c28', VERY_CROWDED: '#e5484d' };

type Params = { roomId: string; runId?: string; mock?: 'error' | 'latest-error' };
type LoadError = 'ROOM_NOT_FOUND' | 'NOT_ROOM_MEMBER' | 'RUN_NOT_FOUND' | 'UNKNOWN';

/**
 * 중간역 추천 화면 (#49, 설계서 그림 30·33·34·37, 명세 8.1~8.3)
 *
 * 한 라우트에 두 보기가 있어요.
 * - 입력 보기(그림 30): 모두의 출발역 → 추천 기준 → "중간역 계산하기"(8.1, 조건 없이 실행)
 * - 결과 보기(그림 33·34): 최신 여부 안내(isStale) → 기준 탭 → 추천 카드(예상 시간·요금, 멤버별 이동, AI 이유) → 후보 제안·경로 확인 → 주변 대안역
 *
 * - 방 진입(포커스)마다 8.2 를 다시 조회해 isStale·staleReasons 를 갱신해요. 실행 기록이 없으면 입력 보기.
 * - runId 가 있으면 8.3 으로 그 실행을 보여요. 최근 실행이 아니면 isStale 이 null(판정 안 함)이라 "다시 추천받기"를 숨겨요.
 * - 방 정보가 바뀌어도 자동으로 다시 추천하지 않아요. 사용자가 "다시 추천받기"를 눌러야 8.1 을 다시 호출해요.
 *
 * 테스트용 (mock):
 *   /rooms/room-1/recommendations                      → 멤버 4명 중 다른 멤버 1명 출발역 미설정 → 계산 버튼 비활성 + 안내
 *   /rooms/room-4/recommendations                      → 2명 중 내 출발역만 미설정 → 내 카드에서 설정하면 계산 가능
 *   결과가 있는 상태에서 내 출발역을 바꾸면 isStale: true(MEMBERS_CHANGED) 안내 + 다시 추천받기
 *   /rooms/room-4/recommendations?mock=error           → 첫 계산 실패(NETWORK_ERROR), 다시 시도하면 성공
 *   /rooms/room-4/recommendations?mock=latest-error    → 첫 8.2 조회 실패, 다시 시도하면 성공
 *
 * 서버 모드(#99): services/recommendation.ts 가 8.1~8.3 을 불러요. ?mock= 은 무시돼요.
 * - 인증 오류(TOKEN_*·401)는 A-1 공통 처리에 맡기고 이 화면에서 따로 안내하지 않아요.
 * - 8.1 시간 초과·연결 실패는 "결과가 저장됐을 수 있어요" 안내를 보여주고, 화면 재진입 시 8.2 로 확인돼요.
 * - "후보로 올리기"는 서버 모드에서 7.15 로 보내요(#101).
 * WS로 최신 여부를 갱신하고, 다른 실행은 새 추천 배너로 안내합니다(#117).
 */
export default function RoomRecommendationsScreen() {
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<Params>();
    const roomId = String(params.roomId);
    const runIdParam = params.runId ? String(params.runId) : undefined;
    const myUserId = getMyUserId();
    const requestId = useRef(0);
    const active = useRef(true);
    const departureLock = useRef(false);
    const departureId = useRef(0);

    const [detail, setDetail] = useState<RoomDetail | null>(null);
    const [run, setRun] = useState<RecommendationRun | null>(null);
    /** 약속역 후보 (7.15): 이미 후보인 역·후보 상한(9개) 확인용 */
    const [proposals, setProposals] = useState<StationProposalList | null>(null);
    const [sharing, setSharing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<LoadError | null>(null);

    const [view, setView] = useState<'input' | 'result'>('result');
    const [criterion, setCriterion] = useState<RecommendationCriterion>('TIME');
    const [stationNameWidth, setStationNameWidth] = useState(0);
    const [running, setRunning] = useState(false);
    /** 상태 반영 전에 버튼이 두 번 눌려도 8.1 을 한 번만 보내도록 바로 바뀌는 값으로 막아요. */
    const runningRef = useRef(false);
    const [runError, setRunError] = useState<{ message: string; missing?: string[] } | null>(null);
    const [openedParticipant, setOpenedParticipant] = useState<string | null>(null);
    const [departureSaving, setDepartureSaving] = useState(false);
    const [notice, setNotice] = useState('');
    const screenContext = useRef({ active: true });
    useEffect(() => {
        const context = { active: true }; screenContext.current = context;
        return () => { context.active = false; };
    }, [roomId]);
    const [newRecommendation, setNewRecommendation] = useState(false);
    const realtimeRequest = useRef({ detail: 0, proposals: 0, recommendation: 0 });
    const runRef = useRef(run);
    useEffect(() => { runRef.current = run; }, [run]);
    const detailRef = useRef(detail);
    useEffect(() => { detailRef.current = detail; }, [detail]);
    const stationAt = useRef(-Infinity);
    const accountScope = roomEventsScope();
    useEffect(() => { stationAt.current = -Infinity; }, [roomId, accountScope]);
    const rejectRoom = () => {
        requestId.current++;
        realtimeRequest.current.detail++; realtimeRequest.current.proposals++; realtimeRequest.current.recommendation++;
        try { removeCachedRoom(roomId, getRoomCacheScope()); } catch {}
        router.replace('/rooms');
    };
    const refreshLatest = async (valid: () => boolean = () => true, replace = false) => {
        if (runningRef.current) return;
        const id = ++realtimeRequest.current.recommendation;
        const scope = roomEventsScope();
        const baseline = requestId.current;
        try {
            const latest = await fetchLatestRecommendation(roomId);
            if (!valid() || scope !== roomEventsScope() || id !== realtimeRequest.current.recommendation
                || baseline !== requestId.current || runningRef.current) return;
            const previous = runRef.current;
            if (replace || !previous) {
                runRef.current = latest; setRun(latest); setView(latest ? 'result' : 'input'); setNewRecommendation(false);
                if (replace && runIdParam) router.setParams({ runId: '' });
            } else if (latest?.runId === previous.runId) {
                setRun(current => current?.runId === latest.runId ? { ...current, isStale: latest.isStale, staleReasons: latest.staleReasons } : current);
            } else if (latest) {
                setNewRecommendation(true);
                setRun(current => current ? { ...current, isStale: null, staleReasons: null } : current);
            }
        } catch (error) {
            if (valid() && scope === roomEventsScope() && id === realtimeRequest.current.recommendation
                && baseline === requestId.current && error instanceof RecommendationError
                && (error.code === 'NOT_ROOM_MEMBER' || error.code === 'ROOM_NOT_FOUND')) rejectRoom();
        }
    };
    useRoomEvents(roomId, {
        rejected: rejectRoom,
        receive: event => {
            if (event.type === 'ROOM_UPDATED' || event.type === 'SELECTED_STATION_CHANGED') {
                const previous = detailRef.current;
                if (!previous) return event.type === 'ROOM_UPDATED' ? ['detail', 'recommendation'] : ['detail'];
                const includeStation = Date.parse(event.at) >= stationAt.current;
                const selected = event.type === 'SELECTED_STATION_CHANGED' ? parseSelectedStationEvent(event.payload) : null;
                const next = event.type === 'ROOM_UPDATED' ? mergeRoomUpdated(previous, event.payload, includeStation)
                    : selected ? { ...previous, ...(includeStation ? selected : {}) } : null;
                if (!next) return event.type === 'ROOM_UPDATED' ? ['detail', 'recommendation'] : ['detail'];
                if (includeStation) stationAt.current = Date.parse(event.at);
                realtimeRequest.current.detail++;
                detailRef.current = next; setDetail(next);
                return;
            }
            if (event.type !== 'RECOMMENDATION_CREATED') return;
            const action = recommendationEventAction(runRef.current?.runId, event.payload.runId, runningRef.current, view === 'result');
            if (action === 'ignore') return false;
            if (action === 'banner') setNewRecommendation(true);
        },
        refresh: async (target, valid) => {
            if (target === 'recommendation') { await refreshLatest(valid); return; }
            const id = ++realtimeRequest.current[target];
            try {
                if (target === 'detail') {
                    const room = await fetchRoomDetail(roomId);
                    if (valid() && id === realtimeRequest.current.detail) setDetail(room);
                } else {
                    const list = await fetchProposals(roomId);
                    if (valid() && id === realtimeRequest.current.proposals) setProposals(list);
                }
            } catch (error) {
                if (valid() && id === realtimeRequest.current[target] && error instanceof RoomError
                    && (error.code === 'NOT_ROOM_MEMBER' || error.code === 'ROOM_NOT_FOUND')) rejectRoom();
            }
        },
    });

    const createFailNext = useRef(params.mock === 'error');
    const latestFailNext = useRef(params.mock === 'latest-error');

    /* ───────── 조회 (8.2 / 8.3) ───────── */

    const load = useCallback(async () => {
        const id = ++requestId.current;
        const scope = accountScope;
        const detailId = ++realtimeRequest.current.detail;
        const proposalsId = ++realtimeRequest.current.proposals;
        const recommendationId = ++realtimeRequest.current.recommendation;
        const current = () => id === requestId.current && scope === roomEventsScope();
        setLoadError(null);
        try {
            const room = await fetchRoomDetail(roomId);
            if (!current()) return;
            if (detailId === realtimeRequest.current.detail) setDetail(room);
            const [list, latest] = await Promise.all([
                fetchProposals(roomId),
                runIdParam
                    ? fetchRecommendation(roomId, runIdParam)
                    : (() => {
                        const fail = latestFailNext.current;
                        latestFailNext.current = false; // 다시 시도하면 성공하도록
                        return fetchLatestRecommendation(roomId, fail ? 'error' : undefined);
                    })(),
            ]);
            if (!current()) return;
            if (proposalsId === realtimeRequest.current.proposals) setProposals(list);
            if (recommendationId === realtimeRequest.current.recommendation) {
                setRun(latest);
                runRef.current = latest;
                setNewRecommendation(false);
                setView(latest ? 'result' : 'input');
            }
        } catch (error) {
            if (!current()) return;
            if (error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            const code = error instanceof RoomError || error instanceof RecommendationError ? error.code : null;
            setLoadError(code === 'ROOM_NOT_FOUND' || code === 'NOT_ROOM_MEMBER' || code === 'RUN_NOT_FOUND' ? code : 'UNKNOWN');
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, [roomId, runIdParam, accountScope]);

    // 방 화면 진입·복귀 시 8.2 를 다시 조회해 isStale 을 갱신합니다 (명세 8.2). 계산 중에는 건너뜀
    useFocusEffect(
        useCallback(() => {
            active.current = true;
            if (!departureLock.current) setDepartureSaving(false);
            if (!running) void load();
            // DOM ref가 아닌 요청 카운터로 이전 화면의 조회를 무효화해요.
            return () => { active.current = false; requestId.current++; departureId.current++; };
        }, [load, running]),
    );

    /* ───────── 파생 값 ───────── */

    const members: RoomMember[] = detail?.members ?? [];
    const missingMembers = members.filter(member => !member.departureStation);
    const tooFew = members.length < 2;
    const blockReason = tooFew
        ? '중간역을 추천하려면 멤버가 2명 이상이어야 해요.'
        : missingMembers.length > 0
            ? (() => {
                const others = missingMembers.filter(m => m.userId !== myUserId).map(m => m.nickname);
                const mineMissing = missingMembers.some(m => m.userId === myUserId);
                if (mineMissing && others.length === 0) return '내 출발역을 먼저 설정해 주세요.';
                if (mineMissing) return `내 출발역과 ${others.join(', ')}님의 출발역이 필요해요.`;
                return `${others.join(', ')}님이 출발역을 설정해야 해요.`;
            })()
            : null;
    const isLatest = run ? run.isStale !== null : true;
    const result = run?.results.find(item => item.criterion === criterion) ?? run?.results[0] ?? null;
    const stationName = formatStationName(result?.recommendedStation.name);
    const stationNameFontSize = stationNameWidth > 0
        ? Math.max(20, Math.min(34, Math.floor(stationNameWidth / (stationName.length * 0.98))))
        : 34;
    const appointmentAt = detail?.appointmentAt ? new Date(detail.appointmentAt) : null;
    const me = members.find(member => member.userId === myUserId);
    const history = useMemo(() => listRecommendationRuns(roomId), [roomId, run]);
    /** 3D 캐릭터 색 (표시용): 나는 'me', 다른 참여자는 목록 순서대로 OTHER_TONES 를 돌려 써요 */
    const memberTones = new Map<string, PassengerTone>();
    members.filter(member => member.userId !== myUserId)
        .forEach((member, index) => memberTones.set(member.userId, OTHER_TONES[index % OTHER_TONES.length]));
    if (me) memberTones.set(me.userId, 'me');

    /* ───────── 동작 ───────── */

    const goBack = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/rooms/[roomId]', params: { roomId } }));

    /** 8.1 실행 (처음 계산 · 다시 추천받기 둘 다 같은 호출) */
    const runRecommendation = async () => {
        if (!detail || running || runningRef.current || blockReason) return;
        runningRef.current = true;
        requestId.current++;
        realtimeRequest.current.recommendation++;
        const scope = roomEventsScope();
        const context = screenContext.current;
        setRunning(true);
        setRunError(null);
        setNotice('');
        try {
            const fail = createFailNext.current;
            createFailNext.current = false; // 다시 시도하면 성공하도록
            const created = await createRecommendation(detail.id, {}, fail ? 'error' : undefined);
            if (!context.active || scope !== roomEventsScope()) return;
            runRef.current = created;
            setNewRecommendation(false);
            setRun(created);
            setOpenedParticipant(null);
            setView('result');
            if (runIdParam) router.setParams({ runId: '' }); // 이전 실행 화면에서 새로 실행했으면 최근 실행으로
        } catch (error) {
            if (!context.active || scope !== roomEventsScope()) return;
            // 인증 오류는 A-1 공통 처리(갱신·로그인 이동)에 맡기고 중복 안내하지 않아요.
            if (error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            if (error instanceof RecommendationError) {
                setRunError({ message: error.message, missing: error.missingUserIds });
            } else {
                setRunError({ message: '추천을 실행하지 못했어요. 잠시 후 다시 시도해 주세요.' });
            }
        } finally {
            runningRef.current = false;
            if (context.active && scope === roomEventsScope()) setRunning(false);
        }
    };

    /** 그림 30 ❹ 내 출발역 설정 — 공통 역 검색 화면(#33) → 7.7 */
    const pickMyDeparture = () => {
        if (!detail) return;
        openStationPicker(
            { purpose: 'departure', contextLabel: detail.name, selectedStationId: me?.departureStation?.id },
            async (station: Station) => {
                if (departureLock.current) return;
                departureLock.current = true;
                const id = ++departureId.current;
                setDepartureSaving(true);
                try {
                    await updateMyDeparture(detail.id, { departureStationId: station.id });
                    if (active.current && id === departureId.current) await load();
                } catch (error) {
                    if (!active.current || id !== departureId.current || error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
                    if (error instanceof RoomError && (error.code === 'NOT_ROOM_MEMBER' || error.code === 'ROOM_NOT_FOUND')) { router.replace('/rooms'); return; }
                    setNotice(error instanceof RoomError ? error.message : '출발역을 저장하지 못했어요.');
                } finally {
                    departureLock.current = false;
                    if (active.current) setDepartureSaving(false);
                }
            },
        );
    };

    /** 그림 33 ❺ 이 역으로 약속방에 공유 → 약속역 후보 제안 (7.14, resultId = 이 결과 카드의 resultId) */
    const shareAsCandidate = async (item: RecommendationResult) => {
        if (!detail || sharing) return;
        const scope = roomEventsScope();
        const context = screenContext.current;
        const current = () => context.active && scope === roomEventsScope();
        setSharing(true);
        setNotice('');
        try {
            await createProposal(detail.id, item.recommendedStation.id, item.resultId);
            if (!current()) return;
            setNotice(`${formatStationName(item.recommendedStation.name)}을 약속역 후보로 올렸어요. 약속방의 '약속역 후보' 탭에서 투표할 수 있어요.`);
        } catch (error) {
            if (!current()) return;
            // 인증 오류는 A-1 공통 처리에 맡기고, 방 접근 불가(403·404)는 기존 접근 불가 화면으로 보여줘요.
            if (error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            if (error instanceof RoomError && (error.code === 'ROOM_NOT_FOUND' || error.code === 'NOT_ROOM_MEMBER')) {
                requestId.current++;
                setLoadError(error.code);
                return;
            }
            setNotice(error instanceof RoomError ? error.message : '후보를 올리지 못했어요. 다시 시도해 주세요.');
        } finally {
            if (current()) {
                const id = ++realtimeRequest.current.proposals;
                try {
                    const list = await fetchProposals(detail.id);
                    if (current() && id === realtimeRequest.current.proposals) setProposals(list);
                } catch {
                    // 목록 재조회 실패는 버튼 상태만 이전 값으로 둡니다
                }
                if (current()) setSharing(false);
            }
        }
    };

    /** 그림 33 "경로 자세히 보기" → 내 출발역 → 추천역 실제 경로 (6.1, 경로 탐색 화면) */
    const openRoute = (item: RecommendationResult) => {
        router.push({
            pathname: '/route-search',
            // #140: 역 ID 로 넘겨 이름 재검색 없이 정확한 역으로 요청해요(이름은 표시용 대체값).
            params: {
                departure: me?.departureStation?.name ?? '',
                ...(me?.departureStation ? { departureId: String(me.departureStation.id) } : {}),
                destination: item.recommendedStation.name,
                destinationId: String(item.recommendedStation.id),
                roomId,
            },
        });
    };

    /* ───────── 렌더 ───────── */

    /** 입력 보기·계산 중·불러오기 화면 위쪽 (시안 07): 뒤로 + 방 이름(작은 회색), 방 이름이 없으면 "중간역 찾기" */
    const lavenderHeader = () => (
        <View style={[lv.header, { paddingTop: insets.top }]}>
            <Pressable style={lv.backButton} onPress={goBack} accessibilityRole="button" accessibilityLabel="뒤로 가기" hitSlop={8}>
                <Ionicons name="chevron-back" size={24} color={LV_TEXT} />
            </Pressable>
            <Text style={lv.headerRoom} numberOfLines={1}>{detail?.name || '중간역 찾기'}</Text>
        </View>
    );

    if (loading && !detail) {
        return (
            <View style={lv.container}>
                <StatusBar style="dark" />
                {lavenderHeader()}
                <View style={lv.center}>
                    <ActivityIndicator color={LV_PURPLE} />
                    <Text style={lv.centerHint}>추천 정보를 불러오고 있어요</Text>
                </View>
            </View>
        );
    }

    if (loadError) {
        const copy = {
            ROOM_NOT_FOUND: { title: '약속방을 찾을 수 없어요', body: '삭제됐거나 없는 약속방이에요.' },
            NOT_ROOM_MEMBER: { title: '참여하지 않은 약속방이에요', body: '초대 코드로 먼저 참여해 주세요.' },
            RUN_NOT_FOUND: { title: '추천 결과를 찾을 수 없어요', body: '이 약속방의 추천 결과가 아니거나 삭제됐어요.' },
            UNKNOWN: { title: '추천 결과를 불러오지 못했어요', body: '네트워크 상태를 확인하고 다시 시도해 주세요.' },
        }[loadError];
        return (
            <View style={lv.container}>
                <StatusBar style="dark" />
                {lavenderHeader()}
                <View style={lv.center}>
                    <View style={lv.centerIcon}><Ionicons name="cloud-offline-outline" size={30} color={LV_GRAY} /></View>
                    <Text style={lv.centerTitle}>{copy.title}</Text>
                    <Text style={lv.centerBody}>{copy.body}</Text>
                    <View style={lv.centerActions}>
                        {loadError === 'UNKNOWN' && (
                            <Pressable style={lv.primaryButton} onPress={() => { setLoading(true); load(); }} accessibilityRole="button">
                                <Text style={lv.primaryText}>다시 시도</Text>
                            </Pressable>
                        )}
                        <Pressable style={lv.secondaryButton} onPress={goBack} accessibilityRole="button"><Text style={lv.secondaryText}>돌아가기</Text></Pressable>
                    </View>
                </View>
            </View>
        );
    }

    /* 계산 중 오버레이 */
    if (running) {
        return (
            <View style={lv.container}>
                <StatusBar style="dark" />
                {lavenderHeader()}
                <View style={lv.center}>
                    <View style={lv.runningCrowd}>
                        {members.map(member => <Passenger key={member.userId} tone={memberTones.get(member.userId) ?? 'other'} size={36} />)}
                    </View>
                    <Text style={lv.centerTitle}>중간역을 계산하고 있어요</Text>
                    <Text style={lv.centerBody}>참여자 {members.length}명의 출발역에서 시간, 요금, 거리 기준으로 가장 알맞은 역을 찾고 있어요.</Text>
                    <ActivityIndicator color={LV_PURPLE} style={{ marginTop: 16 }} />
                </View>
            </View>
        );
    }

    /* ───────── 입력 보기 (그림 30, 시안 07 중간역 찾기) ───────── */
    if (view === 'input' || !run) {
        const doneCount = members.length - missingMembers.length;
        return (
            <View style={lv.container}>
                <StatusBar style="dark" />
                {lavenderHeader()}
                <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                    <ScrollView contentContainerStyle={[lv.content, { paddingBottom: 32 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                        <Text style={lv.title}>어디서 만날까요?</Text>
                        <Text style={lv.desc}>각자 출발역을 넣으면 모두에게 알맞은 역을 찾아요.</Text>

                        {/* 3D 캐릭터 줄 */}
                        <View style={lv.crowd} accessible={false}>
                            {members.map(member => <Passenger key={member.userId} tone={memberTones.get(member.userId) ?? 'other'} size={40} />)}
                        </View>

                        {/* ❹ 모두의 출발역 → 참여자 목록 */}
                        <View style={lv.sectionHead}>
                            <Text style={lv.sectionTitle}>참여자 {members.length}명</Text>
                            <Text style={[lv.counter, missingMembers.length === 0 && lv.counterDone]}>
                                {doneCount}/{members.length}명 설정{missingMembers.length === 0 ? ' 완료' : ''}
                            </Text>
                        </View>
                        <View style={lv.memberCard}>
                            {members.map((member, index) => {
                                const mine = member.userId === myUserId;
                                return (
                                    <View key={member.userId} style={[lv.memberRow, index === members.length - 1 && lv.memberRowLast]}>
                                        <Passenger tone={memberTones.get(member.userId) ?? 'other'} size={30} />
                                        <View style={styles.flex}>
                                            <View style={lv.memberNameRow}>
                                                <Text style={lv.memberName} numberOfLines={1}>{member.nickname}</Text>
                                                {mine && <Text style={lv.meTag}>나</Text>}
                                                {member.role === 'OWNER' && <Text style={lv.ownerTag}>방장</Text>}
                                            </View>
                                            {member.departureStation ? (
                                                <View style={lv.memberStationRow}>
                                                    <Text style={lv.memberStation} numberOfLines={1}>{formatStationName(member.departureStation.name)}</Text>
                                                    {member.departureStation.lines?.map(line => (
                                                        <LineBadge key={line.lineId} line={{ id: line.lineId, name: line.lineName, color: line.color }} size={15} />
                                                    ))}
                                                </View>
                                            ) : (
                                                <Text style={lv.memberStationEmpty}>{mine ? '출발역을 설정해 주세요' : '출발역 미설정'}</Text>
                                            )}
                                        </View>
                                        {mine && (
                                            <Pressable
                                                style={({ pressed }) => [lv.pickButton, departureSaving && lv.pickButtonBusy, pressed && styles.pressed]}
                                                onPress={pickMyDeparture}
                                                disabled={departureSaving}
                                                accessibilityRole="button"
                                                accessibilityLabel="내 출발역 설정"
                                                accessibilityState={{ disabled: departureSaving, busy: departureSaving }}
                                            >
                                                {departureSaving ? <ActivityIndicator size="small" color={LV_PURPLE} /> : <Text style={lv.pickText}>출발역</Text>}
                                            </Pressable>
                                        )}
                                    </View>
                                );
                            })}
                        </View>

                        {/* ❺ 추천 기준 (시안에 없지만 유지) */}
                        <Text style={[lv.sectionTitle, lv.sectionGap, lv.textInset]}>추천 기준</Text>
                        <Text style={lv.sectionSub}>세 기준 모두 계산되고, 선택한 기준을 먼저 보여드려요</Text>
                        <View style={lv.segment}>
                            {CRITERIA.map(item => {
                                const on = criterion === item.key;
                                return (
                                    <Pressable key={item.key} style={[lv.segmentItem, on && lv.segmentItemOn]} onPress={() => setCriterion(item.key)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                                        <Text style={[lv.segmentText, on && lv.segmentTextOn]}>{item.short}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        <View style={lv.chatHint}>
                            <View style={lv.chatIcon} accessible={false}><Text style={lv.chatIconText}>LR</Text></View>
                            <Text style={lv.chatHintText}>원하는 조건이 있으면 채팅에서 <Text style={lv.chatMention}>@링크로</Text>에게 말해 보세요.</Text>
                        </View>

                        {/* 안내: 출발역 미설정, 인원 부족, 실행 실패 */}
                        {blockReason && (
                            <View style={lv.warnBox}>
                                <Ionicons name="information-circle-outline" size={16} color={LV_PURPLE} />
                                <Text style={lv.warnText}>{blockReason}{missingMembers.length > 0 && !tooFew ? ' 모두 설정되면 계산할 수 있어요.' : ''}</Text>
                            </View>
                        )}
                        {runError && (
                            <View style={lv.errorBox}>
                                <Ionicons name="warning-outline" size={17} color={LV_ERROR} />
                                <Text style={lv.errorText}>
                                    {runError.message}
                                    {runError.missing?.length ? ` (${runError.missing.map(id => members.find(m => m.userId === id)?.nickname ?? id).join(', ')})` : ''}
                                </Text>
                            </View>
                        )}
                        {!!notice && <View style={lv.noticeBox}><Ionicons name="information-circle-outline" size={17} color={LV_PURPLE} /><Text style={lv.noticeText}>{notice}</Text></View>}

                        {run && (
                            <Pressable style={lv.linkButton} onPress={() => setView('result')} accessibilityRole="button">
                                <Text style={lv.linkText}>최근 추천 결과 보기</Text>
                                <Ionicons name="chevron-forward" size={15} color={LV_PURPLE} />
                            </Pressable>
                        )}
                    </ScrollView>

                    {/* ❼ 중간역 계산하기 */}
                    <View style={[lv.footer, { paddingBottom: insets.bottom + 14 }]}>
                        <Pressable
                            style={({ pressed }) => [lv.primaryButton, !!blockReason && lv.primaryDisabled, pressed && styles.pressed]}
                            onPress={runRecommendation}
                            disabled={!!blockReason || running}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !!blockReason || running }}
                        >
                            <Text style={lv.primaryText}>{runError ? '다시 시도' : run ? '다시 추천받기' : '중간역 계산하기'}</Text>
                        </Pressable>
                    </View>
                </KeyboardAvoidingView>
            </View>
        );
    }

    /* ───────── 결과 보기 (그림 33·34·37, 시안 08 추천 중간역) ───────── */
    const createdAt = new Date(run.createdAt);
    const serverEmptyResult = !isMockMode() && run.results.length === 0;
    const understoodMessage = serverEmptyResult ? null : run.message;
    const alreadyCandidate = result ? !!proposals?.items.some(item => item.station.id === result.recommendedStation.id) : false;
    const proposalsFull = !!proposals && proposals.items.length >= proposals.maxProposals;
    const shareDisabled = alreadyCandidate || proposalsFull || sharing;
    const shareLabel = alreadyCandidate
        ? '후보에 있어요'
        : proposalsFull
            ? `후보가 가득 찼어요 (${proposals?.items.length}/${proposals?.maxProposals})`
            : sharing ? '후보로 올리는 중' : '후보로 제안';
    const summary = [
        `${members.length}명`,
        appointmentAt ? `${formatMonthDay(appointmentAt)} ${formatTime(appointmentAt)} 약속` : '약속 시각 미정',
        CRITERIA.find(c => c.key === criterion)?.label ?? '',
        constraintSummary(run.appliedConstraints),
    ].filter(Boolean).join(', ');
    /** 시안 "다른 기준 결과": 지금 실행(run.results)에 들어 있는 다른 기준만. 누르면 기준 탭만 바꿔요(새 요청 없음). */
    const otherResults = result ? run.results.filter(item => item.criterion !== result.criterion) : [];
    const showFooter = run.results.length > 0 && !!result;

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />
            {/* 위쪽 (시안 08): 뒤로 + 제목 + 조건 바꾸기(시안의 공유 아이콘 자리) */}
            <View style={[lv.header, { paddingTop: insets.top }]}>
                <Pressable style={lv.backButton} onPress={goBack} accessibilityRole="button" accessibilityLabel="뒤로 가기" hitSlop={8}>
                    <Ionicons name="chevron-back" size={24} color={LV_TEXT} />
                </Pressable>
                <Text style={styles.headerTitle} numberOfLines={1}>추천 중간역</Text>
                <Pressable style={lv.backButton} onPress={() => setView('input')} accessibilityRole="button" accessibilityLabel="조건 바꾸기" hitSlop={8}>
                    <Ionicons name="options-outline" size={21} color={LV_TEXT} />
                </Pressable>
            </View>
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + (showFooter ? 110 : 32) }]} showsVerticalScrollIndicator={false}>
                {newRecommendation && (
                    <View style={styles.newBox}>
                        <Text style={styles.newTitle}>새 추천이 있어요</Text>
                        <Pressable accessibilityRole="button" onPress={() => void refreshLatest(undefined, true)} style={styles.smallButton}>
                            <Text style={styles.smallButtonText}>보기</Text>
                        </Pressable>
                    </View>
                )}
                <Text style={styles.summary}>{summary}</Text>

                {/* 이전 실행(8.3) 표시: isStale === null 이면 판정 안 함, 다시 추천받기 없음 */}
                {run.isStale === null && (
                    <View style={styles.prevBox}>
                        <Ionicons name="time-outline" size={16} color={LV_GRAY} />
                        <Text style={styles.prevText}>{formatMonthDay(createdAt)} {formatTime(createdAt)}에 실행한 이전 추천 결과예요. 최신 여부는 최근 결과에서만 확인할 수 있어요.</Text>
                        <Pressable onPress={() => router.setParams({ runId: '' })} hitSlop={6}><Text style={styles.prevLink}>최근 결과</Text></Pressable>
                    </View>
                )}

                {/* ❶ 최신이 아님 안내 + 다시 추천받기 (최근 실행에서만) */}
                {run.isStale === true && (
                    <View style={styles.staleBox}>
                        <View style={styles.flex}>
                            <Text style={styles.staleTitle}>
                                {staleReasonText(run.staleReasons)}
                            </Text>
                            <Text style={styles.staleBody}>{blockReason ?? '지금 조건으로 다시 추천받아 보세요. 기존 약속역 후보는 그대로 남아요.'}</Text>
                        </View>
                        <Pressable style={[styles.smallButton, !!blockReason && styles.smallButtonOff]} onPress={runRecommendation} disabled={!!blockReason || running} accessibilityRole="button" accessibilityState={{ disabled: !!blockReason || running }}>
                            <Text style={styles.smallButtonText}>다시 추천받기</Text>
                        </Pressable>
                    </View>
                )}
                {/* 결과 보기의 "다시 추천받기"가 실패한 경우에도 안내해요 (APPOINTMENT_PASSED 등) */}
                {runError && (
                    <View style={lv.errorBox}>
                        <Ionicons name="warning-outline" size={17} color={LV_ERROR} />
                        <Text style={lv.errorText}>
                            {runError.message}
                            {runError.missing?.length ? ` (${runError.missing.map(id => members.find(m => m.userId === id)?.nickname ?? id).join(', ')})` : ''}
                        </Text>
                    </View>
                )}
                {run.isStale === false && (
                    <View style={styles.freshRow}><Ionicons name="checkmark-circle" size={15} color={LV_PURPLE} /><Text style={styles.freshText}>지금 약속 시각, 참여자 기준 최신 결과예요, {formatMonthDay(createdAt)} {formatTime(createdAt)} 실행</Text></View>
                )}

                {/* 이렇게 이해했어요 (conditionText → appliedConstraints) */}
                {(run.conditionText || Object.keys(run.appliedConstraints).length > 0 || understoodMessage) && (
                    <View style={styles.understoodBox}>
                        <Text style={styles.understoodTitle}>이렇게 이해했어요</Text>
                        {!!run.conditionText && <Text style={styles.understoodQuote}>&quot;{run.conditionText}&quot;</Text>}
                        <View style={styles.constraintRow}>
                            {constraintChips(run.appliedConstraints, members).map(label => <View key={label} style={styles.constraintChip}><Text style={styles.constraintText}>{label}</Text></View>)}
                            {Object.keys(run.appliedConstraints).length === 0 && <Text style={styles.constraintNone}>적용된 제약 없음</Text>}
                        </View>
                        {!!understoodMessage && <View style={styles.understoodNotice}><Ionicons name="information-circle-outline" size={16} color={LV_PURPLE} /><Text style={styles.understoodMessage}>{understoodMessage}</Text></View>}
                    </View>
                )}

                {/* 결과 없음 (에러 아님, results: []) */}
                {run.results.length === 0 ? (
                    <View style={styles.emptyBox}>
                        <View style={lv.centerIcon}><Ionicons name="search-outline" size={28} color={LV_GRAY} /></View>
                        <Text style={lv.centerTitle}>조건에 맞는 중간역이 없어요</Text>
                        <Text style={lv.centerBody}>{(serverEmptyResult && run.message) || '시간, 환승, 요금 조건을 조금 완화해서 다시 추천받아 보세요.'}</Text>
                        <Pressable style={[lv.primaryButton, { marginTop: 16, alignSelf: 'stretch' }]} onPress={() => setView('input')} accessibilityRole="button"><Text style={lv.primaryText}>조건 바꾸기</Text></Pressable>
                    </View>
                ) : result && (
                    <>
                        {/* ❷ 추천 기준 탭 (시안 3칸 세그먼트) */}
                        <View style={[lv.segment, styles.tabs]}>
                            {CRITERIA.map(item => {
                                const has = run.results.some(r => r.criterion === item.key);
                                const on = criterion === item.key;
                                return (
                                    <Pressable key={item.key} style={[lv.segmentItem, on && lv.segmentItemOn, !has && styles.tabOff]} onPress={() => { setCriterion(item.key); setOpenedParticipant(null); }} disabled={!has} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                                        <Text style={[lv.segmentText, on && lv.segmentTextOn]}>{item.label}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        {/* 추천 역: 작은 보라 라벨(기준) + 큰 역 이름 + 노선 색 3D 열차 */}
                        <View style={styles.stationRow}>
                            <View style={styles.flex} onLayout={({ nativeEvent }) => setStationNameWidth(nativeEvent.layout.width)}>
                                <Text style={styles.stationBadge}>{CRITERIA.find(c => c.key === result.criterion)?.label} 최적 중간역</Text>
                                <Text style={[styles.stationName, { fontSize: stationNameFontSize }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{stationName}</Text>
                            </View>
                            {!!result.recommendedStation.lines?.length && (
                                <View style={styles.trainRow} accessible accessibilityLabel={result.recommendedStation.lines.map(line => line.lineName).join(', ')}>
                                    {result.recommendedStation.lines.slice(0, 3).map(line => <TrainBlock key={line.lineId} line={line.lineId} size={40} />)}
                                </View>
                            )}
                        </View>

                        {/* 내 출발·도착 우선 (#153): 출발 → 도착, 약속까지 여유, 탑승 열차, 계산 근거, 이전 계획 안내 */}
                        {(() => {
                            const mine = result.participantTimes.find(p => p.userId === myUserId);
                            if (!mine) return null;
                            const slack = formatSlack(mine.slackSeconds);
                            return (
                                <View style={styles.myTrip} accessibilityLabel="내 이동">
                                    <Text style={styles.myTripLabel}>내 이동</Text>
                                    <Text style={styles.myTripTime}>{formatTripLine(mine, detail?.appointmentAt ?? null)}</Text>
                                    {!!slack && <Text style={[styles.myTripSlack, (mine.slackSeconds ?? 0) < 0 && styles.myTripLate]}>{slack}</Text>}
                                    {mine.boardingTrain && (
                                        <View style={styles.myTripTrain}>
                                            <Ionicons name="train-outline" size={14} color={LV_PURPLE} />
                                            <Text style={styles.myTripTrainText}>{formatBoardingTrain(mine.boardingTrain)}</Text>
                                        </View>
                                    )}
                                    <Text style={styles.myTripNote}>{sourceNote(mine.source)}</Text>
                                    {run.isStale === true && <Text style={styles.myTripStale}>{stalePlanText(run.staleReasons)}</Text>}
                                </View>
                            );
                        })()}

                        {/* ❸ 이동 정보 요약 (흰 카드 3칸), 모두 추정치라 "예상" 라벨 */}
                        <View style={styles.metrics}>
                            <Metric label="평균 예상 시간" value={formatDurationMinutes(result.metrics.averageMinutes)} />
                            <Metric label="최대 편차" value={`${result.metrics.maxDifferenceMinutes}분`} accent />
                            <Metric label="평균 예상 요금" value={`${result.metrics.averageFare.toLocaleString()}원`} />
                        </View>
                        <Text style={styles.estimateNote}>시간, 요금은 중간역을 고르기 위한 예상 값이에요. 실제 경로는 &apos;경로 자세히 보기&apos;에서 확인해요.</Text>

                        {/* 누가 얼마나 걸리나요 (탭하면 그림 37 상세) */}
                        <Text style={styles.sectionTitle}>누가 얼마나 걸리나요</Text>
                        <View style={styles.participants}>
                            {result.participantTimes.map(p => (
                                <ParticipantRow
                                    key={p.userId}
                                    participant={p}
                                    tone={memberTones.get(p.userId) ?? 'other'}
                                    maxMinutes={result.metrics.maxMinutes}
                                    averageMinutes={result.metrics.averageMinutes}
                                    mine={p.userId === myUserId}
                                    appointmentAt={detail?.appointmentAt ?? null}
                                    stalePlan={run.isStale === true ? stalePlanText(run.staleReasons) : null}
                                    opened={openedParticipant === p.userId}
                                    onPress={() => setOpenedParticipant(prev => (prev === p.userId ? null : p.userId))}
                                />
                            ))}
                            <Text style={styles.legend}>세로선은 평균, 진한 막대가 가장 오래 걸리는 사람</Text>
                        </View>

                        {/* ❹ 추천 이유 */}
                        <View style={styles.reasonBox}>
                            <Text style={styles.reasonTitle}>왜 이 역인가요</Text>
                            <Text style={styles.reasonText}>{result.explanation}</Text>
                            <Text style={styles.reasonSource}>{result.explanationSource === 'AI' ? '경로 계산 결과를 AI가 설명했어요' : '계산 결과로 만든 기본 설명이에요 (AI 설명 연동 전)'}</Text>
                        </View>

                        {!!notice && <View style={lv.noticeBox}><Ionicons name="information-circle-outline" size={17} color={LV_PURPLE} /><Text style={lv.noticeText}>{notice}</Text></View>}

                        {/* ❻ 주변 대안역 (그림 34, 시안 흰 칩) */}
                        {result.nearbyAlternatives.length > 0 && (
                            <>
                                <Text style={styles.subSectionTitle}>이런 역도 있어요</Text>
                                <Text style={styles.sectionSub}>최적 중간역 근처에서 함께 고려해볼 만한 역이에요</Text>
                                <View style={styles.nearbyRow}>
                                    {result.nearbyAlternatives.map(alt => (
                                        <View key={`${alt.station.id}-${alt.relation}`} style={styles.nearbyChip}>
                                            <View style={styles.nearbyMain}>
                                                <LineDot color={result.recommendedStation.lines?.find(l => l.lineId === alt.lineId)?.color ?? LV_GRAY} name={`${alt.lineId}호선`} size={16} />
                                                <View style={styles.nearbyBody}>
                                                    <Text style={styles.nearbyName}>{formatStationName(alt.station.name)}</Text>
                                                    <Text style={styles.nearbyTag}>{alt.relationLabel}</Text>
                                                </View>
                                            </View>
                                            <Text style={styles.nearbyMeta}>최대 {formatDurationMinutes(alt.maxMinutes)} · 예상 {alt.totalFareWon.toLocaleString()}원</Text>
                                        </View>
                                    ))}
                                </View>
                            </>
                        )}

                        {/* 다른 기준 결과 (지금 실행 안의 다른 기준, 누르면 그 기준 탭으로) */}
                        {otherResults.length > 0 && (
                            <>
                                <Text style={[styles.subSectionTitle, styles.otherTitle]}>다른 기준 결과</Text>
                                {otherResults.map(item => (
                                    <Pressable
                                        key={item.criterion}
                                        style={({ pressed }) => [styles.otherRow, pressed && styles.pressed]}
                                        onPress={() => { setCriterion(item.criterion); setOpenedParticipant(null); }}
                                        accessibilityRole="button"
                                    >
                                        <Text style={styles.otherLabel}>{CRITERIA.find(c => c.key === item.criterion)?.label}</Text>
                                        <Text style={styles.otherStation} numberOfLines={1}>{formatStationName(item.recommendedStation.name)}</Text>
                                        <Text style={styles.otherMax}>최대 {formatDurationMinutes(item.metrics.maxMinutes)}</Text>
                                        <Ionicons name="chevron-forward" size={16} color={LV_CHEVRON} />
                                    </Pressable>
                                ))}
                            </>
                        )}
                    </>
                )}

                {/* 이전 추천 기록 (8.3 진입용) */}
                {history.length > 1 && (
                    <View style={styles.historyBox}>
                        <Text style={styles.historyTitle}>이전 추천 기록</Text>
                        {history.filter(item => item.runId !== run.runId).slice(0, 3).map(item => (
                            <Pressable key={item.runId} style={styles.historyRow} onPress={() => router.setParams({ runId: item.runId })} accessibilityRole="button">
                                <Ionicons name="time-outline" size={15} color={LV_GRAY} />
                                <Text style={styles.historyText}>{formatMonthDay(new Date(item.createdAt))} {formatTime(new Date(item.createdAt))} 실행</Text>
                                <Ionicons name="chevron-forward" size={15} color={LV_CHEVRON} />
                            </Pressable>
                        ))}
                    </View>
                )}
            </ScrollView>

            {/* ❺ 아래 고정 두 버튼 (시안 08): 경로 자세히 보기 + 후보 올리기 */}
            {showFooter && result && (
                <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
                    <Pressable style={({ pressed }) => [styles.footerSecondary, !me?.departureStation && styles.secondaryOff, pressed && styles.pressed]} onPress={() => openRoute(result)} disabled={!me?.departureStation} accessibilityRole="button">
                        <Text style={styles.footerSecondaryText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>경로 자세히 보기</Text>
                    </Pressable>
                    <Pressable style={({ pressed }) => [styles.footerPrimary, shareDisabled && styles.footerPrimaryOff, pressed && styles.pressed]} onPress={() => shareAsCandidate(result)} disabled={shareDisabled} accessibilityLabel={shareLabel === '후보에 있어요' ? '이미 약속역 후보에 있어요' : shareLabel} accessibilityRole="button" accessibilityState={{ disabled: shareDisabled, busy: sharing }}>
                        <Text style={styles.footerPrimaryText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{shareLabel}</Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
}

/* ───────────────────────── 보조 컴포넌트 ───────────────────────── */

function LineDot({ color, name, size = 18 }: { color: string; name: string; size?: number }) {
    return (
        <View style={[styles.lineDot, { backgroundColor: color, minWidth: size, height: size, borderRadius: size / 2 }]} accessibilityLabel={name}>
            <Text style={[styles.lineDotText, { fontSize: Math.round(size * 0.55) }]}>{name.replace(/호선$/, '').slice(0, 2)}</Text>
        </View>
    );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <View style={styles.metric}>
            <Text style={styles.metricLabel}>{label}</Text>
            <Text style={[styles.metricValue, accent && styles.metricAccent]}>{value}</Text>
        </View>
    );
}

/** 그림 33 참여자 막대(시안 08 "누가 얼마나 걸리나요") + 그림 37 상세(탭) */
function ParticipantRow({ participant: p, tone, maxMinutes, averageMinutes, mine, appointmentAt, stalePlan, opened, onPress }: { participant: ParticipantTime; tone: PassengerTone; maxMinutes: number; averageMinutes: number; mine: boolean; appointmentAt: string | null; stalePlan: string | null; opened: boolean; onPress: () => void }) {
    const slack = formatSlack(p.slackSeconds);
    // 시안처럼 가장 긴 시간의 1.1배를 막대 끝으로 두고, 평균 위치에 세로선을 그려요.
    const scale = Math.max(maxMinutes, 1) * 1.1;
    const width = Math.min(100, Math.max(3, (p.travelMinutes / scale) * 100));
    const averageLeft = Math.min(100, Math.max(0, (averageMinutes / scale) * 100));
    const longest = p.travelMinutes >= maxMinutes;
    // 서버는 혼잡도 데이터가 없으면 congestion: null 이에요. 이때는 점·라벨과 안내의 혼잡도 부분만 숨겨요.
    const congestionColor = p.congestion ? CONGESTION_COLOR[p.congestion.level] ?? LV_GRAY : LV_GRAY;
    return (
        <Pressable style={styles.participant} onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: opened }} accessibilityLabel={`${p.nickname} 예상 ${formatDurationMinutes(p.travelMinutes)}`}>
            <View style={styles.participantRow}>
                <Passenger tone={tone} size={26} />
                <View style={styles.participantWho}>
                    <View style={styles.participantNameRow}>
                        <Text style={styles.participantName} numberOfLines={1}>{p.nickname}</Text>
                        {mine && <Text style={lv.meTag}>나</Text>}
                    </View>
                    <Text style={styles.participantDep} numberOfLines={1}>{formatStationName(p.departureStation.name)}</Text>
                </View>
                <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${width}%`, backgroundColor: longest ? LV_PURPLE : LV_BAR }]} />
                    <View style={[styles.barAverage, { left: `${averageLeft}%` }]} />
                </View>
                <View style={styles.participantRight}>
                    <Text style={styles.participantMinutes}>{formatDurationMinutes(p.travelMinutes)}</Text>
                    <Text style={styles.participantTransfer}>{p.transferCount === 0 ? '환승 없음' : `환승 ${p.transferCount}회`}</Text>
                </View>
                <Ionicons name={opened ? 'chevron-up' : 'chevron-down'} size={13} color={LV_CHEVRON} />
            </View>
            {opened && (
                <View style={styles.participantDetail}>
                    <Text style={styles.detailTitle}>{p.nickname}님의 경로, {formatStationName(p.departureStation.name)} 출발</Text>
                    {/* #153: 출발 → 도착(서울 기준), 여유, 탑승 열차(열차 번호는 상세에서만) */}
                    <Text style={styles.detailTrip}>{formatTripLine(p, appointmentAt)}{slack ? `, ${slack}` : ''}</Text>
                    {p.boardingTrain && <Text style={styles.segmentText}>탑승 {formatBoardingTrain(p.boardingTrain, true)}</Text>}
                    {!!stalePlan && <Text style={styles.myTripStale}>{stalePlan}</Text>}
                    {p.legs.length > 0
                        ? p.legs.map((leg, i) => {
                            const transfer = i > 0 ? formatLegTransfer(leg) : null;
                            return (
                                <View key={i}>
                                    {!!transfer && <Text style={styles.legTransfer}>{transfer}</Text>}
                                    <View style={styles.segmentRow}>
                                        <LineDot color={p.segments.find(seg => seg.lineId === leg.lineId)?.color ?? LV_GRAY} name={leg.lineName} />
                                        <View style={styles.flex}>
                                            <Text style={styles.segmentText}>{formatLeg(leg)}</Text>
                                            <Text style={styles.legTrain}>{formatLegTrain(leg)}</Text>
                                        </View>
                                    </View>
                                </View>
                            );
                        })
                        : p.segments.map((seg, i) => (
                            <View key={i} style={styles.segmentRow}>
                                <LineDot color={seg.color} name={seg.lineName} />
                                <Text style={styles.segmentText}>{seg.fromStationName} → {seg.toStationName}, {seg.stationCount}개 역</Text>
                            </View>
                        ))}
                    <View style={styles.detailMeta}>
                        <Text style={styles.detailMetaText}>환승 {p.transferCount}회, 예상 {p.fareWon.toLocaleString()}원, {(p.distanceM / 1000).toFixed(1)}km</Text>
                        {p.congestion && <View style={styles.congestion}><View style={[styles.congestionDot, { backgroundColor: congestionColor }]} /><Text style={[styles.congestionText, { color: congestionColor }]}>{p.congestion.levelLabel}</Text></View>}
                    </View>
                    <Text style={styles.detailHint}>출발 예정 {formatSeoulTime(p.departureAt)}{p.congestion ? ' 기준 혼잡도' : ''}, {sourceNote(p.source)}</Text>
                </View>
            )}
        </Pressable>
    );
}

function constraintChips(c: AppliedConstraints, members: RoomMember[]) {
    const chips: string[] = [];
    if (c.maxMinutes !== undefined) chips.push(`모두 ${c.maxMinutes}분 이내`);
    if (c.maxTransfers !== undefined) chips.push(c.maxTransfers === 0 ? '환승 없이' : `환승 ${c.maxTransfers}회 이하`);
    if (c.maxFareWon !== undefined) chips.push(`${c.maxFareWon.toLocaleString()}원 이내`);
    if (c.excludeStationIds?.length) chips.push(`제외 역 ${c.excludeStationIds.length}개`);
    for (const limit of c.memberLimits ?? []) chips.push(`${members.find(m => m.userId === limit.userId)?.nickname ?? '멤버'} ${limit.maxMinutes}분 이내`);
    return chips;
}

function constraintSummary(c: AppliedConstraints) {
    const parts: string[] = [];
    if (c.maxMinutes !== undefined) parts.push(`${c.maxMinutes}분 이내`);
    if (c.maxTransfers !== undefined) parts.push(`환승 ${c.maxTransfers}회 이하`);
    if (c.maxFareWon !== undefined) parts.push(`${c.maxFareWon.toLocaleString()}원 이내`);
    return parts.join(', ');
}

/* ───────────────────────── 스타일 ───────────────────────── */

/* 결과 보기 전용 (#206, design-ref 시안 08 추천 중간역). 입력 보기 스타일(lv)과 같은 라벤더 톤이에요. */
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: LV_BG },
    flex: { flex: 1 },
    pressed: { opacity: 0.85 },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: LV_TEXT, letterSpacing: -0.3 },
    content: { paddingTop: 4, paddingHorizontal: 20 },

    // #224 글자 줄 맞춤: 카드 밖 글자 줄은 카드 안쪽 여백만큼 들여요.
    sectionTitle: { fontSize: 15, fontWeight: '700', color: LV_TEXT, marginTop: 22, marginBottom: 10, paddingHorizontal: ROOM_CARD_PADDING },
    subSectionTitle: { fontSize: 14, fontWeight: '700', color: LV_TEXT, marginTop: 20, paddingHorizontal: ROOM_CARD_PADDING },
    sectionSub: { fontSize: 12, color: LV_GRAY, marginTop: 2, marginBottom: 8, paddingHorizontal: ROOM_CARD_PADDING },

    lineDot: { paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    lineDotText: { color: WHITE, fontWeight: '700' },

    summary: { fontSize: 12.5, color: LV_GRAY, marginTop: 6, paddingHorizontal: ROOM_CARD_PADDING },
    newBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingVertical: 10, paddingLeft: 14, paddingRight: 10, borderRadius: 12, backgroundColor: LV_SOFT },
    newTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: LV_PURPLE },
    prevBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: LV_SOFT },
    prevText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: LV_GRAY },
    prevLink: { fontSize: 12.5, fontWeight: '700', color: LV_PURPLE },
    staleBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingVertical: 11, paddingLeft: 14, paddingRight: 10, borderRadius: 12, backgroundColor: LV_STALE_SOFT },
    staleTitle: { fontSize: 13, lineHeight: 19.5, fontWeight: '600', color: LV_STALE_TEXT },
    staleBody: { fontSize: 12, lineHeight: 18, color: LV_STALE_TEXT, marginTop: 2 },
    smallButton: { height: 34, paddingHorizontal: 12, borderRadius: 10, backgroundColor: LV_PURPLE, alignItems: 'center', justifyContent: 'center' },
    smallButtonOff: { backgroundColor: LV_DISABLED },
    smallButtonText: { fontSize: 12.5, fontWeight: '600', color: WHITE },
    freshRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, paddingHorizontal: ROOM_CARD_PADDING },
    freshText: { flexShrink: 1, fontSize: 12, color: LV_GRAY },

    understoodBox: { marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: WHITE, borderWidth: 1, borderColor: LV_CARD_BORDER, gap: 8 },
    understoodTitle: { fontSize: 11.5, fontWeight: '700', color: LV_PURPLE },
    understoodQuote: { fontSize: 13.5, lineHeight: 20, color: LV_TEXT, fontStyle: 'italic' },
    constraintRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    constraintChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: LV_CHIP_BORDER },
    constraintText: { fontSize: 12, fontWeight: '600', color: LV_PURPLE },
    constraintNone: { fontSize: 12, color: LV_GRAY },
    understoodNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: '#F4F1F7', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
    understoodMessage: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '600', color: '#6F6B78' },

    emptyBox: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 10, gap: 6 },

    tabs: { marginTop: 14 },
    tabOff: { opacity: 0.4 },

    stationRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
    stationBadge: { fontSize: 12.5, fontWeight: '600', color: LV_PURPLE },
    stationName: { fontSize: 34, fontWeight: '800', letterSpacing: -1, color: LV_TEXT, marginTop: 2 },
    trainRow: { flexDirection: 'row', gap: 2 },

    myTrip: { marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: WHITE, borderWidth: 1, borderColor: LV_CARD_BORDER, gap: 4 },
    myTripLabel: { color: LV_PURPLE, fontSize: 11.5, fontWeight: '700' },
    myTripTime: { color: LV_TEXT, fontSize: 17, fontWeight: '700' },
    myTripSlack: { color: LV_PURPLE, fontSize: 13, fontWeight: '600' },
    myTripLate: { color: LV_ERROR },
    myTripTrain: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
    myTripTrainText: { flexShrink: 1, color: LV_TEXT, fontSize: 13 },
    myTripNote: { color: LV_GRAY, fontSize: 11.5 },
    myTripStale: { color: LV_WARN, fontSize: 12, fontWeight: '600' },

    metrics: { flexDirection: 'row', gap: 1, marginTop: 14, borderRadius: 16, borderWidth: 1, borderColor: LV_CARD_BORDER, backgroundColor: LV_CARD_BORDER, overflow: 'hidden' },
    metric: { flex: 1, padding: 12, backgroundColor: WHITE },
    metricLabel: { fontSize: 11.5, color: LV_GRAY },
    metricValue: { fontSize: 18, fontWeight: '700', color: LV_TEXT, marginTop: 3 },
    metricAccent: { color: LV_PURPLE },
    estimateNote: { fontSize: 11.5, lineHeight: 16, color: LV_GRAY, marginTop: 6, paddingHorizontal: ROOM_CARD_PADDING },

    participants: { backgroundColor: WHITE, borderWidth: 1, borderColor: LV_CARD_BORDER, borderRadius: 18, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 6 },
    participant: { paddingVertical: 8 },
    participantRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    participantWho: { width: 72 },
    participantNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    participantName: { flexShrink: 1, fontSize: 13.5, fontWeight: '600', color: LV_TEXT },
    participantDep: { fontSize: 11, color: LV_GRAY },
    bar: { flex: 1, height: 22, borderRadius: 6, backgroundColor: LV_BAR_TRACK },
    barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 6 },
    barAverage: { position: 'absolute', top: -3, bottom: -3, width: 2, marginLeft: -1, backgroundColor: LV_TEXT, opacity: 0.35 },
    participantRight: { width: 58, alignItems: 'flex-end' },
    participantMinutes: { fontSize: 14, fontWeight: '700', color: LV_TEXT },
    participantTransfer: { fontSize: 10.5, color: LV_GRAY },
    legend: { fontSize: 11, color: LV_GRAY, paddingTop: 4, paddingBottom: 6 },
    participantDetail: { marginTop: 8, marginLeft: 34, padding: 12, borderRadius: 12, backgroundColor: LV_BG, gap: 8 },
    detailTitle: { fontSize: 13, fontWeight: '700', color: LV_TEXT },
    detailTrip: { color: LV_TEXT, fontSize: 13, fontWeight: '600', marginBottom: 4 },
    segmentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    segmentText: { fontSize: 12.5, color: LV_TEXT },
    legTransfer: { color: LV_GRAY, fontSize: 12, marginLeft: 26, marginVertical: 2 },
    legTrain: { color: LV_GRAY, fontSize: 11.5 },
    detailMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    detailMetaText: { fontSize: 12, color: LV_GRAY, flexShrink: 1 },
    congestion: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    congestionDot: { width: 8, height: 8, borderRadius: 4 },
    congestionText: { fontSize: 12, fontWeight: '700' },
    detailHint: { fontSize: 11, color: LV_GRAY },

    reasonBox: { marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: LV_SEGMENT },
    reasonTitle: { fontSize: 11.5, fontWeight: '700', color: LV_PURPLE },
    reasonText: { fontSize: 14.5, lineHeight: 22.5, color: LV_TEXT, marginTop: 6 },
    reasonSource: { fontSize: 11, color: LV_GRAY, marginTop: 8 },

    nearbyRow: { alignSelf: 'stretch', gap: 8 },
    nearbyChip: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: WHITE, borderWidth: 1, borderColor: '#EEEAF2', gap: 8 },
    nearbyMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
    nearbyBody: { flex: 1, minWidth: 0, gap: 3 },
    nearbyName: { fontSize: 13.5, fontWeight: '700', color: LV_TEXT },
    nearbyMeta: { fontSize: 12, fontWeight: '600', color: '#6F6B78', textAlign: 'right' },
    nearbyTag: { fontSize: 11, color: '#83808B' },

    otherTitle: { marginBottom: 4 },
    otherRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: ROOM_CARD_PADDING, borderBottomWidth: 1, borderBottomColor: LV_ROW_BORDER },
    otherLabel: { width: 64, fontSize: 12.5, color: LV_GRAY },
    otherStation: { flex: 1, fontSize: 15, fontWeight: '600', color: LV_TEXT },
    otherMax: { fontSize: 13, color: LV_SUBTEXT },

    historyBox: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: WHITE, borderWidth: 1, borderColor: LV_CARD_BORDER, gap: 4 },
    historyTitle: { fontSize: 12.5, fontWeight: '700', color: LV_GRAY },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
    historyText: { flex: 1, fontSize: 13.5, color: LV_TEXT },

    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 8, paddingTop: 12, paddingHorizontal: 16, backgroundColor: LV_BG },
    footerSecondary: { flex: 1, height: 52, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: LV_FIELD_BORDER, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center' },
    secondaryOff: { opacity: 0.5 },
    footerSecondaryText: { fontSize: 15, fontWeight: '600', color: LV_TEXT },
    footerPrimary: { flex: 1.3, height: 52, paddingHorizontal: 10, borderRadius: 14, backgroundColor: LV_PURPLE, alignItems: 'center', justifyContent: 'center' },
    footerPrimaryOff: { backgroundColor: LV_DISABLED },
    footerPrimaryText: { fontSize: 15, fontWeight: '600', color: WHITE },
});

/* 입력 보기·계산 중·불러오기 실패 화면 전용 (#204). 결과 보기 위쪽·세그먼트·안내 상자에서도 같이 써요(#206). */
const lv = StyleSheet.create({
    container: { flex: 1, backgroundColor: LV_BG },
    header: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 12, backgroundColor: LV_BG },
    backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerRoom: { flex: 1, fontSize: 15, color: LV_GRAY, marginRight: 12 },
    content: { paddingTop: 6, paddingHorizontal: 20 },

    // #224 글자 줄 맞춤: 카드 밖 제목·섹션 제목·안내 문구는 카드 안쪽 여백만큼 들여요.
    textInset: { paddingHorizontal: ROOM_CARD_PADDING },
    title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: LV_TEXT, paddingHorizontal: ROOM_CARD_PADDING },
    desc: { fontSize: 13.5, color: LV_GRAY, marginTop: 6, paddingHorizontal: ROOM_CARD_PADDING },
    crowd: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: 84, marginTop: 18, marginBottom: 4, paddingBottom: 10, borderRadius: 18, backgroundColor: LV_SOFT, overflow: 'hidden' },

    sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 20, marginBottom: 6, paddingHorizontal: ROOM_CARD_PADDING },
    sectionGap: { marginTop: 22 },
    sectionTitle: { fontSize: 15, fontWeight: '700', color: LV_TEXT },
    sectionSub: { fontSize: 12.5, color: LV_GRAY, marginTop: 2, marginBottom: 8, paddingHorizontal: ROOM_CARD_PADDING },
    counter: { fontSize: 13, fontWeight: '600', color: LV_WARN },
    counterDone: { color: LV_PURPLE },

    memberCard: { backgroundColor: WHITE, borderWidth: 1, borderColor: LV_CARD_BORDER, borderRadius: 18, paddingVertical: 4, paddingHorizontal: 14 },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: LV_DIVIDER },
    memberRowLast: { borderBottomWidth: 0 },
    memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    memberName: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: LV_TEXT },
    meTag: { fontSize: 11, fontWeight: '700', color: LV_PURPLE },
    ownerTag: { fontSize: 10.5, color: LV_GRAY, backgroundColor: LV_TAG_BG, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 5, overflow: 'hidden' },
    memberStationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
    memberStation: { flexShrink: 1, fontSize: 13, color: LV_GRAY },
    memberStationEmpty: { fontSize: 13, color: LV_WARN, marginTop: 3 },
    pickButton: { height: 36, minWidth: 64, paddingHorizontal: 12, borderWidth: 1, borderColor: LV_FIELD_BORDER, borderRadius: 10, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center' },
    pickButtonBusy: { opacity: 0.6 },
    pickText: { fontSize: 13, fontWeight: '600', color: LV_PURPLE },

    segment: { flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: LV_SEGMENT },
    segmentItem: { flex: 1, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    segmentItemOn: { backgroundColor: WHITE, shadowColor: '#3C285A', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    segmentText: { fontSize: 13, fontWeight: '500', color: LV_GRAY },
    segmentTextOn: { fontWeight: '700', color: LV_TEXT },

    chatHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: LV_CARD_BORDER, backgroundColor: WHITE },
    chatIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: LV_PURPLE },
    chatIconText: { fontSize: 11.5, fontWeight: '800', color: WHITE },
    chatHintText: { flex: 1, fontSize: 12, lineHeight: 18, color: LV_TEXT },
    chatMention: { fontWeight: '700', color: LV_PURPLE },

    warnBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#F4F1F7', marginTop: 14 },
    warnText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '600', color: '#6F6B78' },
    errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 14, backgroundColor: LV_ERROR_SOFT, marginTop: 10 },
    errorText: { flex: 1, fontSize: 12.5, lineHeight: 19, fontWeight: '600', color: LV_ERROR },
    noticeBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 14, backgroundColor: LV_SOFT, marginTop: 10 },
    noticeText: { flex: 1, fontSize: 12.5, lineHeight: 19, fontWeight: '600', color: LV_TEXT },
    linkButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, marginTop: 6 },
    linkText: { fontSize: 13.5, fontWeight: '600', color: LV_PURPLE },

    footer: { paddingHorizontal: 16, paddingTop: 10, backgroundColor: LV_BG },
    primaryButton: { height: 54, borderRadius: 16, backgroundColor: LV_PURPLE, alignItems: 'center', justifyContent: 'center' },
    primaryDisabled: { backgroundColor: LV_DISABLED },
    primaryText: { fontSize: 16, fontWeight: '600', color: WHITE },
    secondaryButton: { height: 50, borderRadius: 16, backgroundColor: WHITE, borderWidth: 1, borderColor: LV_FIELD_BORDER, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { fontSize: 15, fontWeight: '600', color: LV_PURPLE },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, paddingBottom: 60, gap: 8 },
    centerHint: { marginTop: 8, fontSize: 13, color: LV_GRAY },
    centerIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: WHITE, borderWidth: 1, borderColor: LV_CARD_BORDER, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    runningCrowd: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2, minWidth: 120, height: 72, paddingHorizontal: 16, paddingBottom: 8, borderRadius: 18, backgroundColor: LV_SOFT, marginBottom: 10 },
    centerTitle: { fontSize: 17, fontWeight: '800', color: LV_TEXT, textAlign: 'center', letterSpacing: -0.3 },
    centerBody: { fontSize: 13.5, lineHeight: 20, color: LV_GRAY, textAlign: 'center' },
    centerActions: { alignSelf: 'stretch', gap: 10, marginTop: 18 },
});
