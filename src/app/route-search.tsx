import { formatStationName } from '@/utils/station-name';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
    ActivityIndicator,
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
import { MOCK_STATIONS } from '@/mocks/stations';
import RouteCard, { RouteResultSummary } from '@/components/route/RouteCard';
import RouteTimeSelector from '@/components/route/RouteTimeSelector';
import RouteTimeNotice from '@/components/route/RouteTimeNotice';
import BottomTabBar, { useTabBarHeight } from '@/components/bottom-tab-bar';
import TrainBlock from '@/components/train-block';
import { personalRouteTimeBasis, roomRouteTimeBasis, routeTimeOptions } from '@/utils/route-time';
import { searchRoute } from '@/services/route';
import { fetchRoomDetail, getMockRoom } from '@/services/room';
import { fetchStation, searchStations } from '@/services/station';
import { useMock as isMockMode } from '@/services/api/config';
import { ApiError, isAuthError } from '@/services/api/errors';
import { setSelectedRoute } from '@/stores/route-store';
import {
    RouteSearchError,
    type Route,
    type RouteErrorCode,
    type RouteSearchResponse,
    type RouteTimeBasis,
    type RouteTimeSelection,
    type StationSummary,
} from '@/types/route';
import { CARD_PADDING } from '@/constants/layout';

// 라벤더 시안(#184) — 상단 제목·출발/도착 입력·빈 상태·결과 영역에 써요.
const LV_BACKGROUND = '#F7F5FA';
const LV_CARD = '#FFFFFF';
const LV_CARD_BORDER = '#EEEAF2';
const LV_TEXT = '#25212D';
const LV_SECONDARY = '#83808B';
const LV_MAIN = '#5C3F78';
const LV_POINT_LINE = '#E2DDE8';
const LV_FIELD_DIVIDER = '#F1EEF4';
const LV_SWAP_BACKGROUND = '#F4F1F7';
const LV_SUB = '#4A4553';
const LV_SOFT = '#EDE8F3';

type Field = 'departure' | 'destination';
type SortKey = 'FASTEST' | 'FEWER_TRANSFERS' | 'CHEAPEST';

const SORT_TABS: { key: SortKey; label: string }[] = [
    { key: 'FASTEST', label: '최소시간' },
    { key: 'FEWER_TRANSFERS', label: '최소환승' },
    { key: 'CHEAPEST', label: '최저요금' },
];

type SearchState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'success'; data: RouteSearchResponse; searchTime?: RouteTimeSelection; timeBasis: RouteTimeBasis }
    | { status: 'error'; code: RouteErrorCode; message: string };

/** 역 검색 화면(#33)의 Station 을 경로 검색에서 쓰는 형태로 바꿉니다. */
function toStationSummary(station: Station): StationSummary {
    return {
        id: station.id,
        name: station.name,
        lines: station.lines.map(line => line.lineId),
        isSupported: station.isSupported,
    };
}

/**
 * 약속방 경로의 시간 기준을 정할 방의 약속 시각이에요 (#172).
 * 방 캐시(mock 은 mock 방 목록)에 있으면 그 값을 쓰고, 없으면 7.4 방 상세로 확인해요.
 * null 은 약속 없음, undefined 는 확인하지 못함(조회 실패 등)이에요.
 */
async function roomAppointmentAt(roomId: string): Promise<string | null | undefined> {
    const cached = getMockRoom(roomId);
    if (cached) return cached.appointmentAt;
    try {
        return (await fetchRoomDetail(roomId)).appointmentAt;
    } catch {
        return undefined;
    }
}

/** 탭 기준 정렬. 같으면 소요 시간 → 환승 순으로 비교합니다. */
function sortRoutes(routes: Route[], key: SortKey) {
    const time = (r: Route) => r.summary.totalTimeSec;
    const transfer = (r: Route) => r.summary.transferCount;
    const fare = (r: Route) => r.summary.fare;

    return [...routes].sort((a, b) => {
        if (key === 'FEWER_TRANSFERS') return transfer(a) - transfer(b) || time(a) - time(b);
        if (key === 'CHEAPEST') return fare(a) - fare(b) || time(a) - time(b) || transfer(a) - transfer(b);
        return time(a) - time(b) || transfer(a) - transfer(b);
    });
}

export default function RouteSearchScreen() {
    const insets = useSafeAreaInsets();
    const tabBarHeight = useTabBarHeight();

    // 홈 화면 등에서 넘겨받은 초기값 (#32)
    // departureId·destinationId(#140)가 있으면 이름 재검색 없이 그 역 ID 로 요청해요. 이름은 표시용 대체값이에요.
    const params = useLocalSearchParams<{
        departure?: string;
        destination?: string;
        departureId?: string;
        destinationId?: string;
        focus?: Field;
        arrivals?: string;
        roomId?: string;
    }>();

    const [departure, setDeparture] = useState<StationSummary | null>(null);
    const [destination, setDestination] = useState<StationSummary | null>(null);
    const [search, setSearch] = useState<SearchState>({ status: 'idle' });
    const [sortKey, setSortKey] = useState<SortKey>('FASTEST');
    const [searchTime, setSearchTime] = useState<RouteTimeSelection>({ mode: 'now' });
    const [timePickerOpen, setTimePickerOpen] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const sameStation = !!departure && !!destination && departure.id === destination.id;

    const requestId = useRef(0);
    const initialLookupId = useRef({ departure: 0, destination: 0 });

    // 역 검색 화면(/station-search, #33)을 열고, 고른 역을 출발 또는 도착에 넣습니다.
    const openPicker = useCallback((field: Field, current: StationSummary | null) => {
        initialLookupId.current[field]++;
        openStationPicker(
            { purpose: field === 'departure' ? 'origin' : 'destination', selectedStationId: current?.id },
            station => {
                const picked = toStationSummary(station);
                if (field === 'departure') setDeparture(picked);
                else setDestination(picked);
            },
        );
    }, []);

    // 이름으로 넘어온 초기값은 서버 모드에서 서버 역 ID로 찾아요.
    useEffect(() => {
        let active = true;
        const find = async (name: string): Promise<StationSummary | null> => {
            if (isMockMode()) {
                const station = MOCK_STATIONS.find(s => s.name === name.trim());
                return station ? toStationSummary(station) : null;
            }
            const normalized = name.trim().replace(/역$/, '');
            try {
                const result = await searchStations(normalized);
                const station = result.items.find(item => item.isSupported && item.name.trim().replace(/역$/, '') === normalized);
                return station ? toStationSummary(station) : null;
            } catch {
                // 못 찾거나 조회에 실패한 초기값은 비워 둬요. 인증 처리는 A-1이 담당해요.
                return null;
            }
        };
        // ID 로 넘어온 역은 5.3 역 상세로 이름·노선을 채워요. 조회에 실패하면 넘겨받은 이름과 그 ID 로 그대로 요청해요.
        const findById = async (stationId: number, name: string | undefined): Promise<StationSummary | null> => {
            try { return toStationSummary(await fetchStation(stationId)); }
            catch { return name?.trim() ? { id: stationId, name: name.trim(), lines: [], isSupported: true } : null; }
        };
        const fill = async (field: Field, name: string | undefined, rawId: string | undefined) => {
            const stationId = rawId && /^\d+$/.test(rawId) ? Number(rawId) : NaN;
            const byId = Number.isSafeInteger(stationId) && stationId > 0;
            if (!byId && !name) return;
            const id = ++initialLookupId.current[field];
            const station = byId ? await findById(stationId, name) : await find(name!);
            if (!active || id !== initialLookupId.current[field]) return;
            if (field === 'departure') setDeparture(station);
            else setDestination(station);
        };
        void fill('departure', params.departure, params.departureId);
        void fill('destination', params.destination, params.destinationId);
        return () => { active = false; };
    }, [params.departure, params.destination, params.departureId, params.destinationId]);

    useEffect(() => {
        if (params.focus) openPicker(params.focus, null);
        // 화면에 처음 들어올 때 한 번만 반영합니다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const runSearch = useCallback(async (from: StationSummary | null, to: StationSummary | null) => {
        const id = ++requestId.current;
        if (!from || !to) {
            setSearch({ status: 'idle' });
            return;
        }

        // 같은 역도 서버에서 방 권한·역 지원 여부를 확인한 뒤 정상 결과로 안내해요.
        setSearch({ status: 'loading' });

        try {
            const roomId = params.roomId;
            const usedTime = roomId ? undefined : searchTime;
            const [data, appointmentAt] = await Promise.all([
                searchRoute(from, to, roomId ? { roomId } : routeTimeOptions(searchTime)),
                roomId ? roomAppointmentAt(roomId) : Promise.resolve(undefined),
            ]);
            if (id !== requestId.current) return;
            const timeBasis = roomId ? roomRouteTimeBasis(appointmentAt, data.appointmentPassed) : personalRouteTimeBasis(usedTime);
            setSearch({ status: 'success', data, searchTime: usedTime, timeBasis });
        } catch (error) {
            if (id !== requestId.current) return;
            if (error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error))) {
                setSearch({ status: 'idle' });
                return;
            }
            const code = error instanceof RouteSearchError ? error.code : 'EXTERNAL_API_ERROR';
            setSearch({ status: 'error', code, message: error instanceof RouteSearchError ? error.message : '경로를 불러오지 못했어요.' });
        }
    }, [params.roomId, searchTime]);

    // 두 역이 정해지면 바로 검색합니다 (별도 검색 버튼 없음).
    useEffect(() => {
        void runSearch(departure, destination);
        // DOM ref가 아닌 요청 카운터라서 이탈 시 최신 재시도까지 무효화해요.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        return () => { requestId.current++; };
    }, [departure, destination, runSearch]);

    const sortedRoutes = useMemo(
        () => (search.status === 'success' ? sortRoutes(search.data.routes, sortKey) : []),
        [search, sortKey],
    );

    // 탭이 바뀌거나 결과가 새로 오면 맨 위 경로를 펼칩니다.
    useEffect(() => {
        setExpandedId(sortedRoutes[0]?.routeId ?? null);
    }, [sortedRoutes]);

    const goBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/home');
        }
    };

    const swapStations = () => {
        initialLookupId.current.departure++;
        initialLookupId.current.destination++;
        setDeparture(destination);
        setDestination(departure);
    };

    const startGuide = (route: Route) => {
        if (search.status !== 'success' || !departure || !destination || sameStation) return;

        setSelectedRoute({
            route,
            routeSource: search.data.routeSource,
            appointmentPassed: search.data.appointmentPassed,
            notice: search.data.notice,
            ...(search.searchTime ? { searchTime: search.searchTime } : {}),
            timeBasis: search.timeBasis,
            origin: departure,
            destination,
        });

        router.push({
            pathname: '/route-guide',
            params: {
                routeId: route.routeId,
                ...(params.arrivals === 'none' || params.arrivals === 'fail' ? { arrivals: params.arrivals } : {}),
            },
        });
    };

    // 다른 화면에서 값을 넘겨 열었을 때만 뒤로 버튼을 보여요. 탭 바에서 바로 열면 숨겨요.
    const hasBack = [params.roomId, params.departure, params.destination, params.departureId, params.destinationId, params.focus]
        .some(value => !!value);

    const badgeLabel = SORT_TABS.find(tab => tab.key === sortKey)?.label ?? '';

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 상단 헤더 */}
            <View style={[styles.header, { marginTop: insets.top }]}>
                {hasBack && (
                    <Pressable style={styles.backButton} onPress={goBack} accessibilityLabel="뒤로 가기">
                        <Ionicons name="chevron-back" size={24} color={LV_TEXT} />
                    </Pressable>
                )}

                <Text style={styles.headerTitle}>경로 검색</Text>
            </View>

            {/* 출발 / 도착역 (누르면 역 검색 화면) */}
            <View style={styles.stationArea}>
                <View style={styles.stationCard}>
                    <View style={styles.pointColumn}>
                        <View style={styles.startPoint} />
                        <View style={styles.pointLine} />
                        <View style={styles.endPoint} />
                    </View>

                    <View style={styles.stationFields}>
                        <StationField
                            label="출발"
                            station={departure}
                            placeholder="출발역"
                            onPress={() => openPicker('departure', departure)}
                        />
                        <View style={styles.stationDivider} />
                        <StationField
                            label="도착"
                            station={destination}
                            placeholder="도착역"
                            onPress={() => openPicker('destination', destination)}
                        />
                    </View>

                    <Pressable
                        style={({ pressed }) => [styles.swapButton, pressed && styles.pressed]}
                        onPress={swapStations}
                        accessibilityLabel="출발역과 도착역 바꾸기"
                    >
                        <Ionicons name="swap-vertical" size={20} color={LV_MAIN} />
                    </Pressable>
                </View>
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 32 }]}
                showsVerticalScrollIndicator={false}
            >
                {!params.roomId && (
                    <RouteTimeSelector value={searchTime} open={timePickerOpen} onOpen={() => setTimePickerOpen(true)} onClose={() => setTimePickerOpen(false)}
                        onChange={value => {
                            requestId.current++;
                            setSearch(departure && destination ? { status: 'loading' } : { status: 'idle' });
                            setSearchTime(value);
                        }} />
                )}
                {search.status === 'success' && search.searchTime && (
                    <RouteTimeNotice selection={search.searchTime} routes={sameStation ? [] : search.data.routes} mock={isMockMode()} />
                )}

                {search.status === 'success' && search.data.appointmentPassed && !!search.data.notice && (
                    <View style={styles.notice}>
                        <Ionicons name="alert-circle-outline" size={17} color={LV_MAIN} />
                        <Text style={styles.noticeText}>{search.data.notice}</Text>
                    </View>
                )}

                {/* INTERNAL은 계산 출처이며 조회 실패 여부를 뜻하지 않아요. */}
                {search.status === 'success' && search.data.routeSource === 'INTERNAL' && (
                    <View style={styles.notice}>
                        <Ionicons name="information-circle-outline" size={17} color={LV_MAIN} />
                        <Text style={styles.noticeText}>자체 계산한 경로예요.</Text>
                    </View>
                )}

                {/* 결과 요약 (탭 기준 맨 위 경로) */}
                {search.status === 'success' && !sameStation && !!sortedRoutes[0] && (
                    <RouteResultSummary topRoute={sortedRoutes[0]} showDates={!params.roomId} />
                )}

                {/* 정렬 탭 */}
                {!sameStation && (search.status === 'loading' || search.status === 'success') && (
                    <View style={[styles.tabs, search.status !== 'success' && styles.tabsSpaced]}>
                        {SORT_TABS.map(tab => {
                            const active = tab.key === sortKey;
                            return (
                                <Pressable
                                    key={tab.key}
                                    style={[styles.tab, active && styles.tabActive]}
                                    onPress={() => setSortKey(tab.key)}
                                    accessibilityRole="tab"
                                    accessibilityState={{ selected: active }}
                                >
                                    <Text style={[styles.tabText, active && styles.tabTextActive]}>
                                        {tab.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                )}

                {search.status === 'idle' && (
                    <View style={styles.empty}>
                        <TrainBlock line={2} size={56} />
                        <Text style={styles.emptyTitle}>{'출발역과 도착역을 선택하면\n경로를 찾아드려요'}</Text>
                        <Text style={styles.emptyText}>소요시간 요금 환승 예상 혼잡도</Text>
                    </View>
                )}

                {search.status === 'loading' && (
                    <View style={styles.loading}>
                        <ActivityIndicator size="large" color={LV_MAIN} />
                        <Text style={styles.loadingTitle}>경로를 찾고 있어요</Text>
                        <Text style={styles.loadingText}>잠시만 기다려 주세요</Text>
                    </View>
                )}

                {search.status === 'error' && (
                    <ErrorMessage
                        code={search.code}
                        message={search.message}
                        onChangeTime={params.roomId ? undefined : () => setTimePickerOpen(true)}
                        onRetry={() => runSearch(departure, destination)}
                        onRoomList={() => router.replace('/rooms')}
                    />
                )}

                {search.status === 'success' && sameStation && (
                    <Message
                        icon={<Ionicons name="train-outline" size={30} color={LV_MAIN} />}
                        iconBackground={LV_SOFT}
                        title="지하철 이동이 필요 없어요"
                        description="선택한 출발역과 도착역이 같아요. 역을 바꾸면 경로를 다시 찾아요."
                    />
                )}

                {search.status === 'success' && !sameStation && sortedRoutes.length === 0 && (
                    <Message
                        icon={<Ionicons name="git-commit-outline" size={30} color={LV_MAIN} />}
                        iconBackground={LV_SOFT}
                        title="이 조건으로 찾은 경로가 없어요"
                        description="출발역이나 도착역을 바꿔 다시 찾아 주세요."
                    />
                )}

                {search.status === 'success' && !sameStation &&
                    sortedRoutes.map((route, index) => (
                        <RouteCard
                            key={route.routeId}
                            route={route}
                            showDates={!params.roomId}
                            expanded={route.routeId === expandedId}
                            badgeLabel={index === 0 ? badgeLabel : undefined}
                            onPress={() => setExpandedId(route.routeId)}
                            onStart={() => startGuide(route)}
                        />
                    ))}

                {search.status === 'idle' && (
                    <Text style={styles.supportNote}>
                        서울교통공사 1~8호선 역을 지원해요. 그 밖의 역은 <Text style={styles.supportNoteStrong}>미제공</Text>으로 표시되고 선택할 수 없어요.
                    </Text>
                )}
            </ScrollView>

            <BottomTabBar active="route" />
        </View>
    );
}

function StationField({
                          label,
                          station,
                          placeholder,
                          onPress,
                      }: {
    label: string;
    station: StationSummary | null;
    placeholder: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            style={({ pressed }) => [styles.stationField, pressed && styles.pressed]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`${label}역 ${station ? formatStationName(station.name) : '선택'}`}
        >
            {station ? (
                <Text style={styles.stationName} numberOfLines={1}>{formatStationName(station.name)}</Text>
            ) : (
                <Text style={styles.stationPlaceholder}>{placeholder}</Text>
            )}
        </Pressable>
    );
}

function Message({
                     icon,
                     iconBackground,
                     title,
                     description,
                     actionLabel,
                     onAction,
                 }: {
    icon: ReactNode;
    iconBackground: string;
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
}) {
    return (
        <View style={styles.message}>
            <View style={[styles.messageIcon, { backgroundColor: iconBackground }]}>{icon}</View>
            <Text style={styles.messageTitle}>{title}</Text>
            <Text style={styles.messageText}>{description}</Text>

            {actionLabel && onAction && (
                <Pressable
                    style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                    onPress={onAction}
                    accessibilityRole="button"
                >
                    <Text style={styles.retryText}>{actionLabel}</Text>
                </Pressable>
            )}
        </View>
    );
}

function ErrorMessage({ code, message, onRetry, onRoomList, onChangeTime }: {
    code: RouteErrorCode;
    message: string;
    onChangeTime?: () => void;
    onRetry: () => void;
    onRoomList: () => void;
}) {
    if (code === 'VALIDATION_ERROR' || code === 'NO_SERVICE_TIME' || code === 'ARRIVAL_UNREACHABLE') {
        return (
            <Message icon={<Ionicons name="time-outline" size={30} color={LV_MAIN} />} iconBackground={LV_SOFT}
                title={code === 'VALIDATION_ERROR' ? '검색 시각을 확인해 주세요' : code === 'NO_SERVICE_TIME' ? '선택한 시각에는 열차가 없어요' : '그 시각까지 도착하기 어려워요'}
                description={message} actionLabel={onChangeTime ? '시각 바꾸기' : undefined} onAction={onChangeTime} />
        );
    }
    if (code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND') {
        return (
            <Message
                icon={<Ionicons name="lock-closed-outline" size={30} color={LV_MAIN} />}
                iconBackground={LV_SOFT}
                title={code === 'NOT_ROOM_MEMBER' ? '이 약속방에 접근할 수 없어요' : '약속방을 찾을 수 없어요'}
                description={code === 'NOT_ROOM_MEMBER'
                    ? '참여 중인 약속방이 아니에요. 약속방 목록에서 확인해 주세요.'
                    : '삭제됐거나 존재하지 않는 약속방이에요. 약속방 목록에서 확인해 주세요.'}
                actionLabel="약속방 목록으로"
                onAction={onRoomList}
            />
        );
    }

    if (code === 'ROUTE_NOT_FOUND') {
        return (
            <Message
                icon={<Ionicons name="search-outline" size={30} color={LV_MAIN} />}
                iconBackground={LV_SOFT}
                title="지하철 경로를 찾지 못했어요"
                description="다른 출발역이나 도착역을 선택해 보세요"
            />
        );
    }

    if (code === 'STATION_UNSUPPORTED' || code === 'STATION_NOT_FOUND') {
        return (
            <Message
                icon={<Ionicons name="ban-outline" size={30} color={LV_MAIN} />}
                iconBackground={LV_SOFT}
                title="서비스에서 지원하지 않는 역이에요"
                description="서울 내 1~8호선 역을 선택해 주세요"
            />
        );
    }

    return (
        <Message
            icon={<Ionicons name="alert-circle-outline" size={30} color={LV_MAIN} />}
            iconBackground={LV_SOFT}
            title="경로를 불러오지 못했어요"
            description={'네트워크 상태를 확인하고\n다시 시도해 주세요'}
            actionLabel="다시 시도"
            onAction={onRetry}
        />
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: LV_BACKGROUND,
    },

    header: {
        height: 48,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },

    backButton: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
    },

    headerTitle: {
        paddingLeft: 8,
        fontSize: 20,
        fontWeight: '700',
        color: LV_TEXT,
    },

    scrollView: {
        flex: 1,
    },

    content: {
        paddingHorizontal: 20,
        paddingTop: 8,
    },

    stationArea: {
        paddingTop: 8,
        paddingHorizontal: 20,
    },

    stationCard: {
        paddingTop: 6,
        paddingRight: 6,
        paddingBottom: 6,
        paddingLeft: 16,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: LV_CARD_BORDER,
        borderRadius: 18,
        backgroundColor: LV_CARD,
    },

    pointColumn: {
        marginRight: 12,
        alignItems: 'center',
        gap: 3,
    },

    startPoint: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: LV_MAIN,
    },

    pointLine: {
        width: 2,
        height: 30,
        backgroundColor: LV_POINT_LINE,
    },

    endPoint: {
        width: 10,
        height: 10,
        borderWidth: 2.5,
        borderColor: LV_MAIN,
        borderRadius: 5,
        backgroundColor: LV_CARD,
    },

    stationFields: {
        flex: 1,
        minWidth: 0,
    },

    stationField: {
        height: 46,
        justifyContent: 'center',
    },

    stationName: {
        color: LV_TEXT,
        fontSize: 16.5,
        fontWeight: '600',
    },

    stationPlaceholder: {
        color: LV_SECONDARY,
        fontSize: 16.5,
        fontWeight: '600',
    },

    stationDivider: {
        height: 1,
        backgroundColor: LV_FIELD_DIVIDER,
    },

    swapButton: {
        width: 44,
        height: 44,
        marginLeft: 6,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: LV_SWAP_BACKGROUND,
    },

    empty: {
        paddingTop: 36,
        paddingBottom: 12,
        alignItems: 'center',
    },

    emptyTitle: {
        marginTop: 14,
        textAlign: 'center',
        color: LV_TEXT,
        fontSize: 16,
        fontWeight: '700',
        lineHeight: 23,
    },

    emptyText: {
        marginTop: 6,
        textAlign: 'center',
        color: LV_SECONDARY,
        fontSize: 13,
    },

    // 시안(#184)의 아래 안내 문구 자리 — 글자만 있어요.
    supportNote: {
        marginTop: 22,
        // #224 글자 줄 맞춤: 카드 안 글자 시작선에 맞춰요.
        paddingHorizontal: CARD_PADDING,
        color: LV_SECONDARY,
        fontSize: 12,
        lineHeight: 19.2,
    },

    supportNoteStrong: {
        fontWeight: '700',
    },

    notice: {
        marginTop: 12,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        borderWidth: 1,
        borderColor: LV_CARD_BORDER,
        borderRadius: 12,
        backgroundColor: LV_CARD,
    },

    noticeText: {
        flex: 1,
        color: LV_SUB,
        fontSize: 12.5,
        fontWeight: '600',
        lineHeight: 18,
    },

    // 시안 "03 경로 결과"의 정렬 탭
    tabs: {
        marginBottom: 12,
        padding: 3,
        flexDirection: 'row',
        borderRadius: 12,
        backgroundColor: LV_SOFT,
    },

    tabsSpaced: {
        marginTop: 16,
    },

    tab: {
        flex: 1,
        height: 36,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },

    tabActive: {
        backgroundColor: LV_CARD,
        boxShadow: '0px 1px 3px rgba(60,40,90,0.12)',
    },

    tabText: {
        color: LV_SECONDARY,
        fontSize: 13,
        fontWeight: '500',
    },

    tabTextActive: {
        color: LV_TEXT,
        fontWeight: '700',
    },

    loading: {
        paddingVertical: 48,
        alignItems: 'center',
    },

    loadingTitle: {
        marginTop: 12,
        color: LV_TEXT,
        fontSize: 15,
        fontWeight: '700',
    },

    loadingText: {
        marginTop: 4,
        color: LV_SECONDARY,
        fontSize: 13,
    },

    // 시안의 결과 없음 문구: 가운데 15 #83808B, 위아래 60
    message: {
        paddingVertical: 60,
        alignItems: 'center',
    },

    messageIcon: {
        width: 56,
        height: 56,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },

    messageTitle: {
        marginTop: 14,
        textAlign: 'center',
        color: LV_SECONDARY,
        fontSize: 15,
        lineHeight: 22,
    },

    messageText: {
        marginTop: 6,
        textAlign: 'center',
        color: LV_SECONDARY,
        fontSize: 13,
        lineHeight: 19,
    },

    retryButton: {
        width: 150,
        height: 46,
        marginTop: 18,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: LV_MAIN,
    },

    retryText: {
        color: LV_CARD,
        fontSize: 14.5,
        fontWeight: '600',
    },

    pressed: {
        opacity: 0.72,
    },
});
