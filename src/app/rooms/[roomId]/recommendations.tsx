import { formatStationName } from '@/utils/station-name';
import { ApiError, isAuthError } from '@/services/api/errors';
import { useMock as isMockMode } from '@/services/api/config';
import { useCallback, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { openStationPicker, type Station } from '@/app/station-search';
import { formatMonthDay, formatTime } from '@/constants/home-mock';
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
    type RecommendationFilter,
    type RecommendationResult,
    type RecommendationRun,
} from '@/types/recommendation';
import { RoomError, type RoomDetail, type RoomMember, type StationProposalList } from '@/types/room';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const MINT_DEEP = '#12a77a';
const PURPLE = '#6a5ae0';
const PURPLE_SOFT = '#eeecfb';
const WHITE = '#ffffff';
const BG = '#f3f5f8';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const RED = '#d6455d';
const ORANGE = '#c77a00';
const ORANGE_SOFT = '#fff4e0';

const CRITERIA: { key: RecommendationCriterion; label: string; short: string; icon: 'time-outline' | 'wallet-outline' | 'map-outline' }[] = [
    { key: 'TIME', label: '시간 기준', short: '시간', icon: 'time-outline' },
    { key: 'FARE', label: '요금 기준', short: '요금', icon: 'wallet-outline' },
    { key: 'DISTANCE', label: '거리 기준', short: '거리', icon: 'map-outline' },
];

/** 빠른 조건 칩: filter 항목이 있는 건 filter 로, 없는 건 자연어에 붙여 AI 해석으로 보냅니다 (명세 8.1) */
const QUICK_CHIPS: { key: string; label: string; filter?: RecommendationFilter; text?: string }[] = [
    { key: 'fair', label: '시간 비슷하게', text: '모두 이동 시간이 비슷했으면 좋겠어' },
    { key: 'transfer', label: '환승 적게', filter: { maxTransfers: 1 } },
    { key: 'min30', label: '30분 이내', filter: { maxMinutes: 30 } },
    { key: 'fare2000', label: '2,000원 이내', filter: { maxFareWon: 2000 } },
];

const CONGESTION_COLOR: Record<string, string> = { COMFORTABLE: '#2bcf9a', RELAXED: '#8fd14f', NORMAL: '#f2b705', CROWDED: '#f28c28', VERY_CROWDED: '#e5484d' };
const AVATAR_COLORS = [NAVY, MINT, '#8792a8', '#c0c6d1'];

type Params = { roomId: string; runId?: string; mock?: 'error' | 'latest-error' };
type LoadError = 'ROOM_NOT_FOUND' | 'NOT_ROOM_MEMBER' | 'RUN_NOT_FOUND' | 'UNKNOWN';

/**
 * 중간역 추천 화면 (#49, 설계서 그림 30·33·34·37, 명세 8.1~8.3)
 *
 * 한 라우트에 두 보기가 있어요.
 * - 입력 보기(그림 30): 모두의 출발역 → 추천 기준 → 자연어 조건·필터 → "중간역 계산하기"(8.1)
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
 *   조건에 "5분" 처럼 아주 짧은 시간을 넣으면 "조건에 맞는 역 없음"(results: []) 을 볼 수 있어요
 *
 * 서버 모드(#99): services/recommendation.ts 가 8.1~8.3 을 불러요. ?mock= 은 무시돼요.
 * - 인증 오류(TOKEN_*·401)는 A-1 공통 처리에 맡기고 이 화면에서 따로 안내하지 않아요.
 * - 8.1 시간 초과·연결 실패는 "결과가 저장됐을 수 있어요" 안내를 보여주고, 화면 재진입 시 8.2 로 확인돼요.
 * - "후보로 올리기"는 서버 모드에서 7.15 로 보내요(#101).
 * TODO(범위 밖): WS 수신 시 8.2 재조회
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
    const [conditionText, setConditionText] = useState('');
    const [chips, setChips] = useState<Set<string>>(new Set());
    const [running, setRunning] = useState(false);
    /** 상태 반영 전에 버튼이 두 번 눌려도 8.1 을 한 번만 보내도록 바로 바뀌는 값으로 막아요. */
    const runningRef = useRef(false);
    const [runError, setRunError] = useState<{ message: string; missing?: string[] } | null>(null);
    const [openedParticipant, setOpenedParticipant] = useState<string | null>(null);
    const [departureSaving, setDepartureSaving] = useState(false);
    const [notice, setNotice] = useState('');

    const createFailNext = useRef(params.mock === 'error');
    const latestFailNext = useRef(params.mock === 'latest-error');

    /* ───────── 조회 (8.2 / 8.3) ───────── */

    const load = useCallback(async () => {
        const id = ++requestId.current;
        setLoadError(null);
        try {
            const room = await fetchRoomDetail(roomId);
            if (id !== requestId.current) return;
            setDetail(room);
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
            if (id !== requestId.current) return;
            setProposals(list);
            setRun(latest);
            setView(latest ? 'result' : 'input');
        } catch (error) {
            if (id !== requestId.current) return;
            if (error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            const code = error instanceof RoomError || error instanceof RecommendationError ? error.code : null;
            setLoadError(code === 'ROOM_NOT_FOUND' || code === 'NOT_ROOM_MEMBER' || code === 'RUN_NOT_FOUND' ? code : 'UNKNOWN');
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, [roomId, runIdParam]);

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
    const appointmentAt = detail?.appointmentAt ? new Date(detail.appointmentAt) : null;
    const me = members.find(member => member.userId === myUserId);
    const history = useMemo(() => listRecommendationRuns(roomId), [roomId, run]);

    /* ───────── 동작 ───────── */

    const goBack = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/rooms/[roomId]', params: { roomId } }));

    const toggleChip = (key: string) => {
        setChips(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const buildRequest = () => {
        const filter: RecommendationFilter = {};
        const texts: string[] = [];
        for (const chip of QUICK_CHIPS) {
            if (!chips.has(chip.key)) continue;
            if (chip.filter) Object.assign(filter, chip.filter);
            if (chip.text) texts.push(chip.text);
        }
        const text = [conditionText.trim(), ...texts].filter(Boolean).join('. ');
        return { conditionText: text || undefined, filter: Object.keys(filter).length ? filter : undefined };
    };

    /** 8.1 실행 (처음 계산 · 다시 추천받기 둘 다 같은 호출) */
    const runRecommendation = async () => {
        if (!detail || running || runningRef.current || blockReason) return;
        runningRef.current = true;
        setRunning(true);
        setRunError(null);
        setNotice('');
        try {
            const fail = createFailNext.current;
            createFailNext.current = false; // 다시 시도하면 성공하도록
            const created = await createRecommendation(detail.id, buildRequest(), fail ? 'error' : undefined);
            setRun(created);
            setOpenedParticipant(null);
            setView('result');
            if (runIdParam) router.setParams({ runId: '' }); // 이전 실행 화면에서 새로 실행했으면 최근 실행으로
        } catch (error) {
            // 인증 오류는 A-1 공통 처리(갱신·로그인 이동)에 맡기고 중복 안내하지 않아요.
            if (error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            if (error instanceof RecommendationError) {
                setRunError({ message: error.message, missing: error.missingUserIds });
            } else {
                setRunError({ message: '추천을 실행하지 못했어요. 잠시 후 다시 시도해 주세요.' });
            }
        } finally {
            runningRef.current = false;
            setRunning(false);
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
        setSharing(true);
        setNotice('');
        try {
            await createProposal(detail.id, item.recommendedStation.id, item.resultId);
            setNotice(`${formatStationName(item.recommendedStation.name)}을 약속역 후보로 올렸어요. 약속방의 '약속역 후보' 탭에서 투표할 수 있어요.`);
        } catch (error) {
            // 인증 오류는 A-1 공통 처리에 맡기고, 방 접근 불가(403·404)는 기존 접근 불가 화면으로 보여줘요.
            if (error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            if (error instanceof RoomError && (error.code === 'ROOM_NOT_FOUND' || error.code === 'NOT_ROOM_MEMBER')) {
                requestId.current++;
                setLoadError(error.code);
                return;
            }
            setNotice(error instanceof RoomError ? error.message : '후보를 올리지 못했어요. 다시 시도해 주세요.');
        } finally {
            try {
                setProposals(await fetchProposals(detail.id)); // 중복·상한 상태를 서버 기준으로 다시 맞춤
            } catch {
                // 목록 재조회 실패는 버튼 상태만 이전 값으로 둡니다
            }
            setSharing(false);
        }
    };

    /** 그림 33 "경로 자세히 보기" → 내 출발역 → 추천역 실제 경로 (6.1, 경로 탐색 화면) */
    const openRoute = (item: RecommendationResult) => {
        router.push({
            pathname: '/route-search',
            params: { departure: me?.departureStation?.name ?? '', destination: item.recommendedStation.name },
        });
    };

    /* ───────── 렌더 ───────── */

    const header = (title: string, right?: React.ReactNode) => (
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
            <Pressable style={styles.backButton} onPress={goBack} accessibilityRole="button" accessibilityLabel="뒤로 가기" hitSlop={8}>
                <Ionicons name="chevron-back" size={26} color={NAVY} />
            </Pressable>
            <Text style={styles.headerTitle}>{title}</Text>
            <View style={styles.headerRight}>{right ?? (detail && <Text style={styles.roomChip} numberOfLines={1}>{detail.name}</Text>)}</View>
        </View>
    );

    if (loading && !detail) {
        return (
            <View style={styles.container}>
                <StatusBar style="dark" />
                {header('중간역 찾기')}
                <View style={styles.center}>
                    <ActivityIndicator color={NAVY} />
                    <Text style={styles.centerHint}>추천 정보를 불러오고 있어요</Text>
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
            <View style={styles.container}>
                <StatusBar style="dark" />
                {header('중간역 찾기')}
                <View style={styles.center}>
                    <View style={styles.centerIcon}><Ionicons name="cloud-offline-outline" size={30} color={SECONDARY} /></View>
                    <Text style={styles.centerTitle}>{copy.title}</Text>
                    <Text style={styles.centerBody}>{copy.body}</Text>
                    <View style={styles.centerActions}>
                        {loadError === 'UNKNOWN' && (
                            <Pressable style={styles.primaryButton} onPress={() => { setLoading(true); load(); }} accessibilityRole="button">
                                <Text style={styles.primaryText}>다시 시도</Text>
                            </Pressable>
                        )}
                        <Pressable style={styles.secondaryButton} onPress={goBack} accessibilityRole="button"><Text style={styles.secondaryText}>돌아가기</Text></Pressable>
                    </View>
                </View>
            </View>
        );
    }

    /* 계산 중 오버레이 */
    if (running) {
        return (
            <View style={styles.container}>
                <StatusBar style="dark" />
                {header('중간역 찾기')}
                <View style={styles.center}>
                    <View style={styles.runningIcon}><Ionicons name="git-network-outline" size={30} color={WHITE} /></View>
                    <Text style={styles.centerTitle}>중간역을 계산하고 있어요</Text>
                    <Text style={styles.centerBody}>참여자 {members.length}명의 출발역에서 시간·요금·거리 기준으로 가장 알맞은 역을 찾고 있어요.</Text>
                    <ActivityIndicator color={NAVY} style={{ marginTop: 16 }} />
                </View>
            </View>
        );
    }

    /* ───────── 입력 보기 (그림 30) ───────── */
    if (view === 'input' || !run) {
        return (
            <View style={styles.container}>
                <StatusBar style="dark" />
                {header('중간역 찾기')}
                <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                        {/* ❹ 모두의 출발역 */}
                        <View style={styles.rowBetween}>
                            <View>
                                <Text style={styles.sectionTitle}>모두의 출발역</Text>
                                <Text style={styles.sectionSub}>각자 자신의 출발역을 설정해요</Text>
                            </View>
                            <Text style={[styles.counter, missingMembers.length === 0 && styles.counterDone]}>
                                {members.length - missingMembers.length}/{members.length}명 설정{missingMembers.length === 0 ? ' 완료' : ''}
                            </Text>
                        </View>
                        <View style={styles.memberGrid}>
                            {members.map((member, index) => {
                                const mine = member.userId === myUserId;
                                return (
                                    <Pressable
                                        key={member.userId}
                                        style={[styles.memberCard, mine && styles.memberCardMine, !member.departureStation && styles.memberCardEmpty]}
                                        onPress={mine ? pickMyDeparture : undefined}
                                        disabled={!mine || departureSaving}
                                        accessibilityRole={mine ? 'button' : undefined}
                                        accessibilityLabel={mine ? '내 출발역 설정' : undefined}
                                    >
                                        <View style={styles.memberHead}>
                                            <View style={[styles.avatar, { backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }]}>
                                                <Text style={styles.avatarText}>{Array.from(member.nickname)[0]}</Text>
                                            </View>
                                            <Text style={styles.memberName} numberOfLines={1}>{member.nickname}</Text>
                                            {mine && <Text style={styles.meTag}>나</Text>}
                                            {mine && (departureSaving ? <ActivityIndicator size="small" color={MINT_DEEP} /> : <Ionicons name="pencil" size={14} color={MINT_DEEP} />)}
                                        </View>
                                        {member.departureStation ? (
                                            <View style={styles.memberStationRow}>
                                                <Text style={styles.memberStation}>{formatStationName(member.departureStation.name)}</Text>
                                                <View style={styles.lineRow}>
                                                    {member.departureStation.lines?.map(line => <LineDot key={line.lineId} color={line.color} name={line.lineName} />)}
                                                </View>
                                            </View>
                                        ) : (
                                            <Text style={styles.memberStationEmpty}>{mine ? '출발역을 설정해 주세요' : '출발역 미설정'}</Text>
                                        )}
                                    </Pressable>
                                );
                            })}
                        </View>

                        {/* ❺ 추천 기준 */}
                        <Text style={styles.sectionTitle}>추천 기준</Text>
                        <Text style={styles.sectionSub}>세 기준 모두 계산되고, 선택한 기준을 먼저 보여드려요</Text>
                        <View style={styles.chipRow}>
                            {CRITERIA.map(item => (
                                <Pressable key={item.key} style={[styles.chip, criterion === item.key && styles.chipOn]} onPress={() => setCriterion(item.key)} accessibilityRole="button" accessibilityState={{ selected: criterion === item.key }}>
                                    <Text style={[styles.chipText, criterion === item.key && styles.chipTextOn]}>{item.short}</Text>
                                </Pressable>
                            ))}
                        </View>

                        {/* ❻ 이동 조건 입력 */}
                        <View style={styles.rowBetween}>
                            <View>
                                <Text style={styles.sectionTitle}>어떤 곳이면 좋을까요?</Text>
                                <Text style={styles.sectionSub}>원하는 조건을 편하게 말해주세요</Text>
                            </View>
                            <View style={styles.aiTag}><Ionicons name="sparkles" size={13} color={PURPLE} /><Text style={styles.aiTagText}>AI가 조건으로 바꿔요</Text></View>
                        </View>
                        <View style={styles.conditionBox}>
                            <TextInput
                                style={styles.conditionInput}
                                value={conditionText}
                                onChangeText={setConditionText}
                                placeholder="예) 환승은 적고, 모두 30분 안쪽이면 좋겠어"
                                placeholderTextColor="#a1a8b8"
                                multiline
                                maxLength={200}
                                accessibilityLabel="이동 조건 입력"
                            />
                            <View style={styles.quickRow}>
                                {QUICK_CHIPS.map(chip => {
                                    const on = chips.has(chip.key);
                                    return (
                                        <Pressable key={chip.key} style={[styles.quickChip, on && styles.quickChipOn]} onPress={() => toggleChip(chip.key)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                                            {on && <Ionicons name="checkmark" size={13} color={WHITE} />}
                                            <Text style={[styles.quickText, on && styles.quickTextOn]}>{chip.label}</Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>
                        <Text style={styles.hint}>조건을 비우면 제약 없이 추천해요. 자연어와 필터 칩에 같은 항목이 있으면 필터가 우선이에요.</Text>

                        {/* 안내: 출발역 미설정 · 인원 부족 · 실행 실패 */}
                        {blockReason && (
                            <View style={styles.warnBox}>
                                <Ionicons name="alert-circle-outline" size={17} color={ORANGE} />
                                <Text style={styles.warnText}>{blockReason}{missingMembers.length > 0 && !tooFew ? ' 모두 설정되면 계산할 수 있어요.' : ''}</Text>
                            </View>
                        )}
                        {runError && (
                            <View style={styles.errorBox}>
                                <Ionicons name="warning-outline" size={17} color={RED} />
                                <Text style={styles.errorText}>
                                    {runError.message}
                                    {runError.missing?.length ? ` (${runError.missing.map(id => members.find(m => m.userId === id)?.nickname ?? id).join(', ')})` : ''}
                                </Text>
                            </View>
                        )}
                        {!!notice && <View style={styles.noticeBox}><Ionicons name="information-circle-outline" size={17} color={NAVY} /><Text style={styles.noticeText}>{notice}</Text></View>}

                        {run && (
                            <Pressable style={styles.linkButton} onPress={() => setView('result')} accessibilityRole="button">
                                <Text style={styles.linkText}>최근 추천 결과 보기</Text>
                                <Ionicons name="chevron-forward" size={15} color={NAVY} />
                            </Pressable>
                        )}
                    </ScrollView>

                    {/* ❼ 중간역 계산하기 */}
                    <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
                        <Pressable
                            style={({ pressed }) => [styles.primaryButton, !!blockReason && styles.primaryDisabled, pressed && styles.pressed]}
                            onPress={runRecommendation}
                            disabled={!!blockReason || running}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !!blockReason || running }}
                        >
                            <Ionicons name="git-network-outline" size={18} color={WHITE} />
                            <Text style={styles.primaryText}>{runError ? '다시 시도' : run ? '다시 추천받기' : '중간역 계산하기'}</Text>
                        </Pressable>
                    </View>
                </KeyboardAvoidingView>
            </View>
        );
    }

    /* ───────── 결과 보기 (그림 33·34·37) ───────── */
    const createdAt = new Date(run.createdAt);
    const serverEmptyResult = !isMockMode() && run.results.length === 0;
    const understoodMessage = serverEmptyResult ? null : run.message;
    const alreadyCandidate = result ? !!proposals?.items.some(item => item.station.id === result.recommendedStation.id) : false;
    const proposalsFull = !!proposals && proposals.items.length >= proposals.maxProposals;
    const shareDisabled = alreadyCandidate || proposalsFull || sharing;
    const shareLabel = alreadyCandidate
        ? '이미 약속역 후보에 있어요'
        : proposalsFull
            ? `후보가 가득 찼어요 (${proposals?.items.length}/${proposals?.maxProposals})`
            : sharing ? '후보로 올리는 중' : '이 역으로 약속방에 공유';
    const summary = [
        `${members.length}명`,
        appointmentAt ? `${formatMonthDay(appointmentAt)} ${formatTime(appointmentAt)} 약속` : '약속 시각 미정',
        CRITERIA.find(c => c.key === criterion)?.label ?? '',
        constraintSummary(run.appliedConstraints),
    ].filter(Boolean).join(' · ');

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />
            {header('추천 중간역', (
                <Pressable style={styles.headerAction} onPress={() => setView('input')} accessibilityRole="button" accessibilityLabel="조건 바꾸기">
                    <Ionicons name="options-outline" size={20} color={NAVY} />
                </Pressable>
            ))}
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
                <Text style={styles.summary}>{summary}</Text>

                {/* 이전 실행(8.3) 표시: isStale === null 이면 판정 안 함, 다시 추천받기 없음 */}
                {run.isStale === null && (
                    <View style={styles.prevBox}>
                        <Ionicons name="time-outline" size={16} color={SECONDARY} />
                        <Text style={styles.prevText}>{formatMonthDay(createdAt)} {formatTime(createdAt)}에 실행한 이전 추천 결과예요. 최신 여부는 최근 결과에서만 확인할 수 있어요.</Text>
                        <Pressable onPress={() => router.setParams({ runId: '' })} hitSlop={6}><Text style={styles.prevLink}>최근 결과</Text></Pressable>
                    </View>
                )}

                {/* ❶ 최신이 아님 안내 + 다시 추천받기 (최근 실행에서만) */}
                {run.isStale === true && (
                    <View style={styles.staleBox}>
                        <Ionicons name="alert-circle" size={18} color={ORANGE} />
                        <View style={styles.flex}>
                            <Text style={styles.staleTitle}>
                                {[run.staleReasons?.includes('APPOINTMENT_CHANGED') && '약속 시각이 바뀌었어요', run.staleReasons?.includes('MEMBERS_CHANGED') && '참여자나 출발역이 바뀌었어요'].filter(Boolean).join(' · ')}
                            </Text>
                            <Text style={styles.staleBody}>{blockReason ?? '지금 조건으로 다시 추천받아 보세요. 기존 약속역 후보는 그대로 남아요.'}</Text>
                        </View>
                        <Pressable style={[styles.staleButton, !!blockReason && styles.staleButtonOff]} onPress={runRecommendation} disabled={!!blockReason || running} accessibilityRole="button" accessibilityState={{ disabled: !!blockReason || running }}>
                            <Text style={styles.staleButtonText}>다시 추천받기</Text>
                        </Pressable>
                    </View>
                )}
                {/* 결과 보기의 "다시 추천받기"가 실패한 경우에도 안내해요 (APPOINTMENT_PASSED 등) */}
                {runError && (
                    <View style={styles.errorBox}>
                        <Ionicons name="warning-outline" size={17} color={RED} />
                        <Text style={styles.errorText}>
                            {runError.message}
                            {runError.missing?.length ? ` (${runError.missing.map(id => members.find(m => m.userId === id)?.nickname ?? id).join(', ')})` : ''}
                        </Text>
                    </View>
                )}
                {run.isStale === false && (
                    <View style={styles.freshRow}><Ionicons name="checkmark-circle" size={15} color={MINT_DEEP} /><Text style={styles.freshText}>지금 약속 시각·참여자 기준 최신 결과예요 · {formatMonthDay(createdAt)} {formatTime(createdAt)} 실행</Text></View>
                )}

                {/* 이렇게 이해했어요 (conditionText → appliedConstraints) */}
                {(run.conditionText || Object.keys(run.appliedConstraints).length > 0 || understoodMessage) && (
                    <View style={styles.understoodBox}>
                        <View style={styles.understoodHead}><Ionicons name="sparkles" size={14} color={PURPLE} /><Text style={styles.understoodTitle}>이렇게 이해했어요</Text></View>
                        {!!run.conditionText && <Text style={styles.understoodQuote}>"{run.conditionText}"</Text>}
                        <View style={styles.constraintRow}>
                            {constraintChips(run.appliedConstraints, members).map(label => <View key={label} style={styles.constraintChip}><Text style={styles.constraintText}>{label}</Text></View>)}
                            {Object.keys(run.appliedConstraints).length === 0 && <Text style={styles.constraintNone}>적용된 제약 없음</Text>}
                        </View>
                        {!!understoodMessage && <Text style={styles.understoodMessage}>{understoodMessage}</Text>}
                    </View>
                )}

                {/* 결과 없음 (에러 아님, results: []) */}
                {run.results.length === 0 ? (
                    <View style={styles.emptyBox}>
                        <View style={styles.centerIcon}><Ionicons name="search-outline" size={28} color={SECONDARY} /></View>
                        <Text style={styles.centerTitle}>조건에 맞는 중간역이 없어요</Text>
                        <Text style={styles.centerBody}>{(serverEmptyResult && run.message) || '시간·환승·요금 조건을 조금 완화해서 다시 추천받아 보세요.'}</Text>
                        <Pressable style={[styles.primaryButton, { marginTop: 16, alignSelf: 'stretch' }]} onPress={() => setView('input')} accessibilityRole="button"><Text style={styles.primaryText}>조건 바꾸기</Text></Pressable>
                    </View>
                ) : result && (
                    <>
                        {/* ❷ 추천 기준 탭 */}
                        <View style={styles.tabs}>
                            {CRITERIA.map(item => {
                                const has = run.results.some(r => r.criterion === item.key);
                                const on = criterion === item.key;
                                return (
                                    <Pressable key={item.key} style={[styles.tab, on && styles.tabOn, !has && styles.tabOff]} onPress={() => { setCriterion(item.key); setOpenedParticipant(null); }} disabled={!has} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                                        <Text style={[styles.tabText, on && styles.tabTextOn]}>{item.label}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        {/* 추천 카드 */}
                        <View style={styles.card}>
                            <View style={styles.cardBadge}><Text style={styles.cardBadgeText}>{CRITERIA.find(c => c.key === result.criterion)?.label} 최적 중간역</Text></View>
                            <View style={styles.stationRow}>
                                <Text style={styles.stationName}>{formatStationName(result.recommendedStation.name)}</Text>
                                <View style={styles.lineRow}>{result.recommendedStation.lines?.map(line => <LineDot key={line.lineId} color={line.color} name={line.lineName} size={22} />)}</View>
                            </View>

                            {/* ❸ 이동 정보 요약 — 모두 추정치라 "예상" 라벨 */}
                            <View style={styles.metrics}>
                                <Metric label="평균 예상 시간" value={`${Math.round(result.metrics.averageMinutes)}분`} />
                                <Metric label="최대 편차" value={`${result.metrics.maxDifferenceMinutes}분`} accent />
                                <Metric label="평균 예상 요금" value={`${result.metrics.averageFare.toLocaleString()}원`} />
                            </View>
                            <Text style={styles.estimateNote}>시간·요금은 중간역을 고르기 위한 예상 값이에요. 실제 경로는 '경로 자세히 보기'에서 확인해요.</Text>

                            {/* 참여자별 이동 (탭하면 그림 37 상세) */}
                            <View style={styles.participants}>
                                {result.participantTimes.map((p, index) => (
                                    <ParticipantRow
                                        key={p.userId}
                                        participant={p}
                                        color={AVATAR_COLORS[index % AVATAR_COLORS.length]}
                                        maxMinutes={result.metrics.maxMinutes}
                                        mine={p.userId === myUserId}
                                        opened={openedParticipant === p.userId}
                                        onPress={() => setOpenedParticipant(prev => (prev === p.userId ? null : p.userId))}
                                    />
                                ))}
                            </View>

                            {/* ❹ AI 추천 이유 */}
                            <View style={styles.reasonBox}>
                                <View style={styles.reasonHead}><Ionicons name="sparkles" size={15} color={PURPLE} /><Text style={styles.reasonTitle}>AI 추천 이유</Text></View>
                                <Text style={styles.reasonText}>{result.explanation}</Text>
                                <Text style={styles.reasonSource}>{result.explanationSource === 'AI' ? '경로 계산 결과를 AI가 설명했어요' : '계산 결과로 만든 기본 설명이에요 (AI 설명 연동 전)'}</Text>
                            </View>

                            {/* ❺ 공유 · 경로 */}
                            <Pressable style={({ pressed }) => [styles.primaryButton, shareDisabled && styles.primaryDisabled, pressed && styles.pressed]} onPress={() => shareAsCandidate(result)} disabled={shareDisabled} accessibilityRole="button">
                                <Ionicons name={alreadyCandidate ? 'checkmark-done' : proposalsFull ? 'alert-circle-outline' : 'paper-plane-outline'} size={18} color={WHITE} />
                                <Text style={styles.primaryText}>{shareLabel}</Text>
                            </Pressable>
                            <Pressable style={[styles.secondaryButton, !me?.departureStation && styles.secondaryOff]} onPress={() => openRoute(result)} disabled={!me?.departureStation} accessibilityRole="button">
                                <Text style={styles.secondaryText}>경로 자세히 보기</Text>
                            </Pressable>
                        </View>

                        {!!notice && <View style={styles.noticeBox}><Ionicons name="information-circle-outline" size={17} color={NAVY} /><Text style={styles.noticeText}>{notice}</Text></View>}

                        {/* ❻ 주변 대안역 (그림 34) */}
                        {result.nearbyAlternatives.length > 0 && (
                            <>
                                <Text style={[styles.sectionTitle, { marginTop: 8 }]}>이런 역도 있어요</Text>
                                <Text style={styles.sectionSub}>최적 중간역 근처에서 함께 고려해볼 만한 역이에요</Text>
                                <View style={styles.nearbyRow}>
                                    {result.nearbyAlternatives.map(alt => (
                                        <View key={`${alt.station.id}-${alt.relation}`} style={styles.nearbyCard}>
                                            <View style={styles.rowBetween}>
                                                <Text style={styles.nearbyName}>{formatStationName(alt.station.name)}</Text>
                                                <LineDot color={result.recommendedStation.lines?.find(l => l.lineId === alt.lineId)?.color ?? NAVY} name={`${alt.lineId}호선`} />
                                            </View>
                                            <View style={styles.nearbyTag}><Text style={styles.nearbyTagText}>{alt.relationLabel}</Text></View>
                                            <Text style={styles.nearbyMeta}>최대 {alt.maxMinutes}분 · 예상 {alt.totalFareWon.toLocaleString()}원</Text>
                                        </View>
                                    ))}
                                </View>
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
                                <Ionicons name="time-outline" size={15} color={SECONDARY} />
                                <Text style={styles.historyText}>{formatMonthDay(new Date(item.createdAt))} {formatTime(new Date(item.createdAt))} 실행</Text>
                                <Ionicons name="chevron-forward" size={15} color="#c0c6d1" />
                            </Pressable>
                        ))}
                    </View>
                )}
            </ScrollView>
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
            <Text style={[styles.metricValue, accent && { color: MINT_DEEP }]}>{value}</Text>
        </View>
    );
}

/** 그림 33 참여자 막대 + 그림 37 상세(탭) */
function ParticipantRow({ participant: p, color, maxMinutes, mine, opened, onPress }: { participant: ParticipantTime; color: string; maxMinutes: number; mine: boolean; opened: boolean; onPress: () => void }) {
    const ratio = maxMinutes > 0 ? Math.max(0.08, p.travelMinutes / maxMinutes) : 0;
    // 서버는 혼잡도 데이터가 없으면 congestion: null 이에요. 이때는 점·라벨과 안내의 혼잡도 부분만 숨겨요.
    const congestionColor = p.congestion ? CONGESTION_COLOR[p.congestion.level] ?? SECONDARY : SECONDARY;
    return (
        <Pressable style={styles.participant} onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: opened }} accessibilityLabel={`${p.nickname} 예상 ${p.travelMinutes}분`}>
            <View style={styles.participantRow}>
                <View style={[styles.dot, { backgroundColor: color }]} />
                <Text style={styles.participantName} numberOfLines={1}>{p.nickname}{mine ? ' (나)' : ''}</Text>
                <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: color }]} /></View>
                <Text style={styles.participantMinutes}>{p.travelMinutes}분</Text>
                <Ionicons name={opened ? 'chevron-up' : 'chevron-down'} size={14} color="#c0c6d1" />
            </View>
            {opened && (
                <View style={styles.participantDetail}>
                    <Text style={styles.detailTitle}>{p.nickname}님의 경로 · {formatStationName(p.departureStation.name)} 출발</Text>
                    {p.segments.map((seg, i) => (
                        <View key={i} style={styles.segmentRow}>
                            <LineDot color={seg.color} name={seg.lineName} />
                            <Text style={styles.segmentText}>{seg.fromStationName} → {seg.toStationName} · {seg.stationCount}개 역</Text>
                        </View>
                    ))}
                    <View style={styles.detailMeta}>
                        <Text style={styles.detailMetaText}>환승 {p.transferCount}회 · 예상 {p.fareWon.toLocaleString()}원 · {(p.distanceM / 1000).toFixed(1)}km</Text>
                        {p.congestion && <View style={styles.congestion}><View style={[styles.congestionDot, { backgroundColor: congestionColor }]} /><Text style={[styles.congestionText, { color: congestionColor }]}>{p.congestion.levelLabel}</Text></View>}
                    </View>
                    <Text style={styles.detailHint}>출발 예정 {formatTime(new Date(p.departureAt))}{p.congestion ? ' 기준 혼잡도' : ''} · 다익스트라 추정치예요</Text>
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
    return parts.join(' · ');
}

/* ───────────────────────── 스타일 ───────────────────────── */

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER },
    backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: NAVY, letterSpacing: -0.3 },
    headerRight: { minWidth: 44, maxWidth: 130, alignItems: 'flex-end' },
    headerAction: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    roomChip: { fontSize: 11, fontWeight: '800', color: MINT_DEEP, backgroundColor: '#e6f8f1', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, overflow: 'hidden' },
    content: { padding: 20, gap: 10 },

    sectionTitle: { fontSize: 16, fontWeight: '800', color: NAVY, letterSpacing: -0.3 },
    sectionSub: { fontSize: 12.5, fontWeight: '500', color: SECONDARY, marginTop: 2 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    counter: { fontSize: 12.5, fontWeight: '700', color: ORANGE },
    counterDone: { color: MINT_DEEP },
    hint: { fontSize: 12, lineHeight: 18, fontWeight: '500', color: SECONDARY },

    memberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
    memberCard: { width: '48%', flexGrow: 1, padding: 14, borderRadius: 16, backgroundColor: WHITE, borderWidth: 1.5, borderColor: BORDER, gap: 10 },
    memberCardMine: { borderColor: MINT },
    memberCardEmpty: { backgroundColor: '#fbfbfd' },
    memberHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: WHITE, fontSize: 13, fontWeight: '800' },
    memberName: { flex: 1, fontSize: 14, fontWeight: '800', color: NAVY },
    meTag: { fontSize: 10, fontWeight: '800', color: MINT_DEEP, backgroundColor: '#e6f8f1', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
    memberStationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
    memberStation: { fontSize: 15, fontWeight: '700', color: NAVY, flexShrink: 1 },
    memberStationEmpty: { fontSize: 13, fontWeight: '700', color: ORANGE },
    lineRow: { flexDirection: 'row', gap: 4 },
    lineDot: { paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    lineDotText: { color: WHITE, fontWeight: '800' },

    chipRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    chip: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: BORDER, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center' },
    chipOn: { borderColor: MINT, backgroundColor: '#e6f8f1' },
    chipText: { fontSize: 14, fontWeight: '700', color: NAVY },
    chipTextOn: { color: MINT_DEEP },
    aiTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    aiTagText: { fontSize: 12, fontWeight: '700', color: PURPLE },
    conditionBox: { borderRadius: 18, borderWidth: 1.5, borderColor: PURPLE, backgroundColor: WHITE, padding: 14, gap: 12 },
    conditionInput: { minHeight: 64, fontSize: 15, fontWeight: '500', color: NAVY, textAlignVertical: 'top', ...Platform.select({ web: { outlineStyle: 'none' } as object }) },
    quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    quickChip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: PURPLE_SOFT, backgroundColor: PURPLE_SOFT },
    quickChipOn: { backgroundColor: PURPLE, borderColor: PURPLE },
    quickText: { fontSize: 13, fontWeight: '700', color: PURPLE },
    quickTextOn: { color: WHITE },

    warnBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, backgroundColor: ORANGE_SOFT },
    warnText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#7a4e00' },
    errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#fdecef' },
    errorText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600', color: RED },
    noticeBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#e9edf5' },
    noticeText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600', color: NAVY },
    linkButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10 },
    linkText: { fontSize: 14, fontWeight: '700', color: NAVY },

    footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
    primaryButton: { height: 54, borderRadius: 16, backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    primaryDisabled: { backgroundColor: '#b9c0cf' },
    primaryText: { fontSize: 15, fontWeight: '800', color: WHITE },
    secondaryButton: { height: 50, borderRadius: 16, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
    secondaryOff: { opacity: 0.5 },
    secondaryText: { fontSize: 15, fontWeight: '700', color: NAVY },
    pressed: { opacity: 0.85 },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, paddingBottom: 60, gap: 8 },
    centerHint: { marginTop: 8, fontSize: 13, fontWeight: '600', color: SECONDARY },
    centerIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    runningIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    centerTitle: { fontSize: 17, fontWeight: '800', color: NAVY, textAlign: 'center', letterSpacing: -0.3 },
    centerBody: { fontSize: 13.5, lineHeight: 20, fontWeight: '500', color: SECONDARY, textAlign: 'center' },
    centerActions: { alignSelf: 'stretch', gap: 10, marginTop: 18 },

    summary: { fontSize: 12.5, fontWeight: '600', color: SECONDARY, textAlign: 'center' },
    prevBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#e9edf5' },
    prevText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: SECONDARY },
    prevLink: { fontSize: 12.5, fontWeight: '800', color: NAVY },
    staleBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: ORANGE_SOFT },
    staleTitle: { fontSize: 13.5, fontWeight: '800', color: '#7a4e00' },
    staleBody: { fontSize: 12, lineHeight: 17, fontWeight: '500', color: '#7a4e00', marginTop: 2 },
    staleButton: { height: 36, paddingHorizontal: 12, borderRadius: 10, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
    staleButtonOff: { backgroundColor: '#b9c0cf' },
    staleButtonText: { fontSize: 12.5, fontWeight: '800', color: WHITE },
    freshRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    freshText: { fontSize: 12, fontWeight: '600', color: MINT_DEEP },

    understoodBox: { padding: 14, borderRadius: 14, backgroundColor: PURPLE_SOFT, gap: 8 },
    understoodHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    understoodTitle: { fontSize: 13, fontWeight: '800', color: PURPLE },
    understoodQuote: { fontSize: 13, fontWeight: '600', color: NAVY, fontStyle: 'italic' },
    constraintRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    constraintChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: WHITE },
    constraintText: { fontSize: 12, fontWeight: '700', color: PURPLE },
    constraintNone: { fontSize: 12, fontWeight: '600', color: SECONDARY },
    understoodMessage: { fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: ORANGE },

    emptyBox: { alignItems: 'center', padding: 24, borderRadius: 18, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, gap: 6 },

    tabs: { flexDirection: 'row', gap: 8, marginTop: 4 },
    tab: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1.5, borderColor: BORDER, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center' },
    tabOn: { borderColor: MINT, backgroundColor: '#e6f8f1' },
    tabOff: { opacity: 0.4 },
    tabText: { fontSize: 13.5, fontWeight: '700', color: NAVY },
    tabTextOn: { color: MINT_DEEP },

    card: { padding: 18, borderRadius: 22, backgroundColor: WHITE, borderWidth: 2, borderColor: NAVY, gap: 14 },
    cardBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: NAVY },
    cardBadgeText: { fontSize: 11.5, fontWeight: '800', color: WHITE },
    stationRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    stationName: { fontSize: 30, fontWeight: '800', color: NAVY, letterSpacing: -0.8 },
    metrics: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER, paddingVertical: 12 },
    metric: { flex: 1, alignItems: 'center', gap: 4, borderRightWidth: 1, borderRightColor: BORDER },
    metricLabel: { fontSize: 11.5, fontWeight: '600', color: SECONDARY },
    metricValue: { fontSize: 20, fontWeight: '800', color: NAVY },
    estimateNote: { fontSize: 11.5, lineHeight: 16, fontWeight: '500', color: SECONDARY, marginTop: -6 },

    participants: { gap: 4 },
    participant: { paddingVertical: 4 },
    participantRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dot: { width: 20, height: 20, borderRadius: 10 },
    participantName: { width: 64, fontSize: 13.5, fontWeight: '700', color: NAVY },
    bar: { flex: 1, height: 10, borderRadius: 5, backgroundColor: '#eef1f6', overflow: 'hidden' },
    barFill: { height: 10, borderRadius: 5 },
    participantMinutes: { width: 40, textAlign: 'right', fontSize: 13.5, fontWeight: '800', color: NAVY },
    participantDetail: { marginTop: 8, marginLeft: 30, padding: 12, borderRadius: 12, backgroundColor: BG, gap: 8 },
    detailTitle: { fontSize: 13, fontWeight: '800', color: NAVY },
    segmentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    segmentText: { fontSize: 12.5, fontWeight: '600', color: NAVY },
    detailMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    detailMetaText: { fontSize: 12, fontWeight: '600', color: SECONDARY, flexShrink: 1 },
    congestion: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    congestionDot: { width: 8, height: 8, borderRadius: 4 },
    congestionText: { fontSize: 12, fontWeight: '800' },
    detailHint: { fontSize: 11, fontWeight: '500', color: SECONDARY },

    reasonBox: { padding: 14, borderRadius: 14, backgroundColor: PURPLE_SOFT, gap: 6 },
    reasonHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    reasonTitle: { fontSize: 13.5, fontWeight: '800', color: PURPLE },
    reasonText: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: NAVY },
    reasonSource: { fontSize: 11.5, fontWeight: '500', color: SECONDARY },

    nearbyRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
    nearbyCard: { flex: 1, padding: 14, borderRadius: 16, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, gap: 8 },
    nearbyName: { fontSize: 15, fontWeight: '800', color: NAVY },
    nearbyTag: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: '#e6f8f1' },
    nearbyTagText: { fontSize: 11, fontWeight: '800', color: MINT_DEEP },
    nearbyMeta: { fontSize: 12, fontWeight: '600', color: SECONDARY },

    historyBox: { marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, gap: 8 },
    historyTitle: { fontSize: 13, fontWeight: '800', color: SECONDARY },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
    historyText: { flex: 1, fontSize: 13, fontWeight: '600', color: NAVY },
});
