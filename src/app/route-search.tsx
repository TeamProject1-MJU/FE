import { formatStationName } from '@/utils/station-name';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { openStationPicker, type Station } from '@/app/station-search';
import { MOCK_STATIONS } from '@/mocks/stations';
import RouteCard from '@/components/route/RouteCard';
import { searchRoute } from '@/services/route';
import { searchStations } from '@/services/station';
import { useMock as isMockMode } from '@/services/api/config';
import { ApiError, isAuthError } from '@/services/api/errors';
import { setSelectedRoute } from '@/stores/route-store';
import {
    RouteSearchError,
    type Route,
    type RouteErrorCode,
    type RouteSearchResponse,
    type StationSummary,
} from '@/types/route';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const BACKGROUND = '#f3f5f8';
const WHITE = '#ffffff';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const AI = '#6a5ae0';

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
    | { status: 'success'; data: RouteSearchResponse }
    | { status: 'error'; code: RouteErrorCode };

/** 역 검색 화면(#33)의 Station 을 경로 검색에서 쓰는 형태로 바꿉니다. */
function toStationSummary(station: Station): StationSummary {
    return {
        id: station.id,
        name: station.name,
        lines: station.lines.map(line => line.lineId),
        isSupported: station.isSupported,
    };
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

    // 홈 화면 등에서 넘겨받은 초기값 (#32)
    const params = useLocalSearchParams<{
        departure?: string;
        destination?: string;
        focus?: Field;
        arrivals?: string;
        roomId?: string;
    }>();

    const [departure, setDeparture] = useState<StationSummary | null>(null);
    const [destination, setDestination] = useState<StationSummary | null>(null);
    const [search, setSearch] = useState<SearchState>({ status: 'idle' });
    const [sortKey, setSortKey] = useState<SortKey>('FASTEST');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [inputError, setInputError] = useState('');

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
        const fill = async (field: Field, name: string) => {
            const id = ++initialLookupId.current[field];
            const station = await find(name);
            if (!active || id !== initialLookupId.current[field]) return;
            if (field === 'departure') setDeparture(station);
            else setDestination(station);
        };
        if (params.departure) void fill('departure', params.departure);
        if (params.destination) void fill('destination', params.destination);
        return () => { active = false; };
    }, [params.departure, params.destination]);

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

        if (from.id === to.id) {
            setInputError('출발역과 도착역을 다르게 설정해 주세요.');
            setSearch({ status: 'idle' });
            return;
        }

        setInputError('');
        setSearch({ status: 'loading' });

        try {
            const data = await searchRoute(from, to, params.roomId ? { roomId: params.roomId } : {});
            if (id !== requestId.current) return;
            setSearch({ status: 'success', data });
        } catch (error) {
            if (id !== requestId.current) return;
            if (error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error))) {
                setSearch({ status: 'idle' });
                return;
            }
            const code = error instanceof RouteSearchError ? error.code : 'EXTERNAL_API_ERROR';
            setSearch({ status: 'error', code });
        }
    }, [params.roomId]);

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
        if (search.status !== 'success' || !departure || !destination) return;

        setSelectedRoute({
            route,
            routeSource: search.data.routeSource,
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

    const badgeLabel = SORT_TABS.find(tab => tab.key === sortKey)?.label ?? '';

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 상단 헤더 */}
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable style={styles.backButton} onPress={goBack} accessibilityLabel="뒤로 가기">
                    <Ionicons name="chevron-back" size={25} color={NAVY} />
                </Pressable>

                <Text style={styles.headerTitle}>경로 탐색</Text>

                <View style={styles.headerRight} />
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
                showsVerticalScrollIndicator={false}
            >
                {/* 출발 / 도착역 (누르면 역 검색 화면) */}
                <View style={styles.stationCard}>
                    <View style={styles.pointColumn}>
                        <View style={styles.startPoint} />
                        <View style={styles.pointDash} />
                        <View style={styles.endPoint} />
                    </View>

                    <View style={styles.stationFields}>
                        <StationField
                            label="출발"
                            station={departure}
                            placeholder="출발역을 검색하세요"
                            onPress={() => openPicker('departure', departure)}
                        />
                        <View style={styles.stationDivider} />
                        <StationField
                            label="도착"
                            station={destination}
                            placeholder="도착역을 검색하세요"
                            onPress={() => openPicker('destination', destination)}
                        />
                    </View>

                    <Pressable
                        style={({ pressed }) => [styles.swapButton, pressed && styles.pressed]}
                        onPress={swapStations}
                        accessibilityLabel="출발역과 도착역 바꾸기"
                    >
                        <Ionicons name="swap-vertical" size={22} color={NAVY} />
                    </Pressable>
                </View>

                {!!inputError && (
                    <View style={styles.inputError}>
                        <Ionicons name="alert-circle-outline" size={17} color="#dc5050" />
                        <Text style={styles.inputErrorText}>{inputError}</Text>
                    </View>
                )}

                {search.status === 'success' && search.data.appointmentPassed && !!search.data.notice && (
                    <View style={styles.notice}>
                        <Ionicons name="alert-circle-outline" size={17} color="#c58a00" />
                        <Text style={styles.noticeText}>{search.data.notice}</Text>
                    </View>
                )}

                {/* INTERNAL은 계산 출처이며 조회 실패 여부를 뜻하지 않아요. */}
                {search.status === 'success' && search.data.routeSource === 'INTERNAL' && (
                    <View style={styles.notice}>
                        <Ionicons name="information-circle-outline" size={17} color="#c58a00" />
                        <Text style={styles.noticeText}>자체 계산한 경로예요.</Text>
                    </View>
                )}

                {/* 정렬 탭 */}
                {(search.status === 'loading' || search.status === 'success') && (
                    <View style={styles.tabs}>
                        {SORT_TABS.map(tab => {
                            const active = tab.key === sortKey;
                            return (
                                <Pressable
                                    key={tab.key}
                                    style={styles.tab}
                                    onPress={() => setSortKey(tab.key)}
                                    accessibilityRole="tab"
                                    accessibilityState={{ selected: active }}
                                >
                                    <Text style={[styles.tabText, active && styles.tabTextActive]}>
                                        {tab.label}
                                    </Text>
                                    {active && <View style={styles.tabUnderline} />}
                                </Pressable>
                            );
                        })}

                        <View style={styles.aiLabel}>
                            <Ionicons name="sparkles-outline" size={17} color={AI} />
                            <Text style={styles.aiLabelText}>혼잡도{'\n'}예측</Text>
                        </View>
                    </View>
                )}

                {search.status === 'idle' && (
                    <Message
                        icon={<Ionicons name="git-commit-outline" size={34} color={NAVY} />}
                        iconBackground="#e8f8f1"
                        title={'출발역과 도착역을 선택하면\n경로를 찾아드려요'}
                        description="소요시간 · 요금 · 환승 · 예상 혼잡도"
                    />
                )}

                {search.status === 'loading' && (
                    <View style={styles.loading}>
                        <ActivityIndicator size="large" color={MINT} />
                        <Text style={styles.loadingTitle}>경로를 찾고 있어요</Text>
                        <Text style={styles.loadingText}>잠시만 기다려 주세요</Text>
                    </View>
                )}

                {search.status === 'error' && (
                    <ErrorMessage
                        code={search.code}
                        onRetry={() => runSearch(departure, destination)}
                    />
                )}

                {search.status === 'success' &&
                    sortedRoutes.map((route, index) => (
                        <RouteCard
                            key={route.routeId}
                            route={route}
                            expanded={route.routeId === expandedId}
                            badgeLabel={index === 0 ? badgeLabel : undefined}
                            onPress={() => setExpandedId(route.routeId)}
                            onStart={() => startGuide(route)}
                        />
                    ))}
            </ScrollView>
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
            <Text style={styles.stationLabel}>{label}</Text>
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

function ErrorMessage({ code, onRetry }: { code: RouteErrorCode; onRetry: () => void }) {
    if (code === 'ROUTE_NOT_FOUND') {
        return (
            <Message
                icon={<Ionicons name="search-outline" size={30} color={SECONDARY} />}
                iconBackground="#eef1f5"
                title="지하철 경로를 찾지 못했어요"
                description="다른 출발역이나 도착역을 선택해 보세요"
            />
        );
    }

    if (code === 'STATION_UNSUPPORTED' || code === 'STATION_NOT_FOUND') {
        return (
            <Message
                icon={<Ionicons name="ban-outline" size={30} color={SECONDARY} />}
                iconBackground="#eef1f5"
                title="서비스에서 지원하지 않는 역이에요"
                description="서울 내 1~8호선 역을 선택해 주세요"
            />
        );
    }

    return (
        <Message
            icon={<Ionicons name="alert-circle-outline" size={32} color="#e5484d" />}
            iconBackground="#fdecec"
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
        backgroundColor: BACKGROUND,
    },

    header: {
        paddingHorizontal: 16,
        paddingBottom: 16,
        backgroundColor: WHITE,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },

    backButton: {
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
    },

    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: NAVY,
    },

    headerRight: {
        width: 36,
    },

    scrollView: {
        flex: 1,
    },

    content: {
        paddingHorizontal: 20,
        paddingTop: 16,
    },

    stationCard: {
        minHeight: 92,
        paddingVertical: 10,
        paddingLeft: 14,
        paddingRight: 12,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 16,
        backgroundColor: WHITE,
    },

    pointColumn: {
        width: 22,
        alignItems: 'center',
        alignSelf: 'stretch',
        paddingVertical: 8,
    },

    startPoint: {
        width: 10,
        height: 10,
        borderWidth: 2,
        borderColor: NAVY,
        borderRadius: 5,
    },

    pointDash: {
        flex: 1,
        marginVertical: 4,
        borderLeftWidth: 2,
        borderStyle: 'dotted',
        borderColor: '#c3c9d4',
    },

    endPoint: {
        width: 9,
        height: 9,
        borderRadius: 5,
        backgroundColor: MINT,
    },

    stationFields: {
        flex: 1,
        marginLeft: 6,
        marginRight: 10,
    },

    stationField: {
        paddingVertical: 3,
    },

    stationLabel: {
        color: SECONDARY,
        fontSize: 11,
        fontWeight: '600',
    },

    stationName: {
        marginTop: 1,
        color: NAVY,
        fontSize: 18.5,
        fontWeight: '800',
    },

    stationPlaceholder: {
        marginTop: 2,
        color: SECONDARY,
        fontSize: 15.5,
        fontWeight: '500',
    },

    stationDivider: {
        height: 1,
        marginVertical: 4,
        backgroundColor: BORDER,
    },

    swapButton: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: BACKGROUND,
    },

    inputError: {
        marginTop: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },

    inputErrorText: {
        color: '#dc5050',
        fontSize: 13,
        fontWeight: '600',
    },

    notice: {
        marginTop: 12,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        borderWidth: 1,
        borderColor: '#f6e3b0',
        borderRadius: 12,
        backgroundColor: '#fff8e6',
    },

    noticeText: {
        flex: 1,
        color: '#8a5a00',
        fontSize: 12.5,
        fontWeight: '600',
        lineHeight: 18,
    },

    tabs: {
        marginTop: 18,
        flexDirection: 'row',
        alignItems: 'center',
    },

    tab: {
        marginRight: 16,
        paddingBottom: 6,
    },

    tabText: {
        color: SECONDARY,
        fontSize: 14.5,
        fontWeight: '600',
    },

    tabTextActive: {
        color: NAVY,
        fontWeight: '800',
    },

    tabUnderline: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 2.5,
        borderRadius: 2,
        backgroundColor: MINT,
    },

    aiLabel: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },

    aiLabelText: {
        color: AI,
        fontSize: 11,
        fontWeight: '700',
        lineHeight: 12,
    },

    loading: {
        marginTop: 40,
        alignItems: 'center',
    },

    loadingTitle: {
        marginTop: 12,
        color: NAVY,
        fontSize: 15,
        fontWeight: '800',
    },

    loadingText: {
        marginTop: 4,
        color: SECONDARY,
        fontSize: 13,
        fontWeight: '600',
    },

    message: {
        marginTop: 90,
        alignItems: 'center',
    },

    messageIcon: {
        width: 64,
        height: 64,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },

    messageTitle: {
        marginTop: 16,
        textAlign: 'center',
        color: NAVY,
        fontSize: 17,
        fontWeight: '800',
        lineHeight: 24,
    },

    messageText: {
        marginTop: 8,
        textAlign: 'center',
        color: SECONDARY,
        fontSize: 13.5,
        fontWeight: '600',
        lineHeight: 19,
    },

    retryButton: {
        width: 150,
        height: 48,
        marginTop: 20,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: NAVY,
    },

    retryText: {
        color: WHITE,
        fontSize: 15.5,
        fontWeight: '700',
    },

    pressed: {
        opacity: 0.72,
    },
});
