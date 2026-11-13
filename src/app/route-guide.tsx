import RouteNotices from '@/components/route/RouteNotices';
import RouteTimeNotice from '@/components/route/RouteTimeNotice';
import { formatArrivalSlack, formatRouteDateTime } from '@/utils/route-time';
import { formatStationName } from '@/utils/station-name';
import { formatClock, formatTotalTime } from '@/components/route/format';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import KakaoMap from '@/components/KakaoMap';
import Congestion from '@/components/route/Congestion';
import NextTrains from '@/components/route/NextTrains';
import { formatFare } from '@/components/route/RouteCard';
import RouteMapLegend from '@/components/route/RouteMapLegend';
import RouteMapPreview from '@/components/route/RouteMapPreview';
import RouteTimeline from '@/components/route/RouteTimeline';
import { useRouteMap } from '@/hooks/use-route-map';
import { useMock as isMockMode } from '@/services/api/config';
import { getSessionGeneration } from '@/services/auth';
import { getAuthStatus, getSession } from '@/stores/auth-store';
import { getSelectedRoute } from '@/stores/route-store';
import type { RouteStep } from '@/types/route';

const NAVY = '#0f1c3f';
const MINT_DEEP = '#12a77a';
const BACKGROUND = '#f3f5f8';
const WHITE = '#ffffff';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
/** 서버 모드 경로 지도 높이. 경로선과 역 마커가 보이면서 아래 경로 정보 카드가 첫 화면에 걸리도록 정했어요. */
const ROUTE_MAP_HEIGHT = 220;

/** 홈과 같은 계정 기준(로그인 세대:userId). 계정이 바뀐 뒤에는 지도 메시지를 처리하지 않아요. */
function currentAccount() {
    const userId = getSession()?.userId;
    return getAuthStatus() === 'signedIn' && userId ? `${getSessionGeneration()}:${userId}` : null;
}

/**
 * 경로 안내 화면 (#35, 상세설계서 그림 21)
 *
 * 명세 6.1: 별도 경로 안내 API 없음. 경로 탐색에서 고른 route 객체를 그대로 받아
 * route.steps 의 guidance·line·direction·stops 를 그립니다.
 * 지도 (#129): 서버 모드는 카카오맵에 구간 경로선·혼잡도 색·출발/환승/도착 마커와 범례를 보여주고,
 * mock 모드는 기존 정적 그림(RouteMapPreview)을 그대로 보여줍니다. 지도가 실패해도 아래 경로 정보는 그대로예요.
 * TODO: 현재 이동 단계(step index) 추적·실시간 위치 안내는 후속 이슈에서 구현합니다.
 */
export default function RouteGuideScreen() {
    const insets = useSafeAreaInsets();
    const { routeId, arrivals } = useLocalSearchParams<{ routeId?: string; arrivals?: string }>();
    const selected = getSelectedRoute(routeId);
    const firstSubway = selected?.route.steps.find(step => step.type === 'SUBWAY');
    const serverMode = !isMockMode();
    const routeMap = useRouteMap(selected?.route ?? null, serverMode, currentAccount());

    const goBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/route-search');
    };

    /** 승차 구간 → 표지판 방향 확인 (명세 9.1 route 파트에 넣을 값을 함께 넘깁니다) */
    const openSignCheck = (step: RouteStep) => {
        const station = step.stops[0];
        router.push({
            pathname: '/ai-direction',
            params: {
                stationId: String(station?.id ?? ''),
                stationName: station?.name ?? '',
                lineId: String(step.line?.id ?? ''),
                lineName: step.line?.name ?? '',
                // 방향 코드가 없으면 비워 두고, 서버가 headsign(방면 이름)으로 비교합니다.
                direction: step.directionCode ?? '',
                headsign: step.direction ?? '',
            },
        });
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable style={styles.backButton} onPress={goBack} accessibilityLabel="뒤로 가기">
                    <Ionicons name="chevron-back" size={25} color={NAVY} />
                </Pressable>
                <Text style={styles.headerTitle}>경로 안내</Text>
                <View style={styles.backButton} />
            </View>

            {!selected ? (
                <View style={styles.empty}>
                    <Text style={styles.emptyTitle}>선택한 경로가 없어요</Text>
                    <Pressable style={styles.button} onPress={() => router.replace('/route-search')}>
                        <Text style={styles.buttonText}>경로 탐색으로</Text>
                    </Pressable>
                </View>
            ) : selected.origin.id === selected.destination.id ? (
                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
                    {selected.searchTime && <RouteTimeNotice selection={selected.searchTime} routes={selected.origin.id === selected.destination.id ? [] : [selected.route]} mock={isMockMode()} />}
                    {selected.appointmentPassed && !!selected.notice && (
                        <View style={styles.notice}>
                            <Ionicons name="alert-circle-outline" size={17} color="#c58a00" />
                            <Text style={styles.noticeText}>{selected.notice}</Text>
                        </View>
                    )}
                    {selected.routeSource === 'INTERNAL' && (
                        <View style={styles.notice}>
                            <Ionicons name="information-circle-outline" size={18} color="#9a6a00" />
                            <Text style={styles.noticeText}>자체 계산한 경로예요.</Text>
                        </View>
                    )}
                    <View style={styles.card}>
                        <Text style={styles.title}>지하철 이동이 필요 없어요</Text>
                        <Text style={styles.meta}>선택한 출발역과 도착역이 같아요.</Text>
                        <RouteNotices summary={selected.route.summary} />
                    </View>
                    <Pressable style={styles.button} onPress={goBack}>
                        <Text style={styles.buttonText}>경로 검색으로 돌아가기</Text>
                    </Pressable>
                </ScrollView>
            ) : (
                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
                    {selected.searchTime && <RouteTimeNotice selection={selected.searchTime} routes={selected.origin.id === selected.destination.id ? [] : [selected.route]} mock={isMockMode()} />}
                    {selected.appointmentPassed && !!selected.notice && (
                        <View style={styles.notice}>
                            <Ionicons name="alert-circle-outline" size={17} color="#c58a00" />
                            <Text style={styles.noticeText}>{selected.notice}</Text>
                        </View>
                    )}

                    {selected.routeSource === 'INTERNAL' && (
                        <View style={styles.notice}>
                            <Ionicons name="information-circle-outline" size={18} color="#9a6a00" />
                            <Text style={styles.noticeText}>자체 계산한 경로예요.</Text>
                        </View>
                    )}

                    {serverMode && routeMap.data ? (
                        <>
                            <View style={styles.map}>
                                <KakaoMap
                                    key={routeMap.mapKey}
                                    center={routeMap.data.center}
                                    myLocation={null}
                                    markers={routeMap.data.markers}
                                    lines={routeMap.data.lines}
                                    fitBounds={routeMap.data.bounds}
                                    fitRevision={routeMap.fitRevision}
                                    label="경로 지도"
                                    onRegionChange={routeMap.onRegionChange}
                                    onError={routeMap.onError}
                                />
                            </View>
                            {!routeMap.failed && <RouteMapLegend map={routeMap.data} />}
                        </>
                    ) : (
                        <RouteMapPreview route={selected.route} />
                    )}

                    <View style={styles.card}>
                        <Text style={styles.title} numberOfLines={1}>
                            {formatStationName(selected.origin.name)} → {formatStationName(selected.destination.name)}
                        </Text>

                        <View style={styles.timeRow}>
                            <Text style={styles.time}>
                                {formatTotalTime(selected.route.summary)}
                            </Text>
                            {!!formatClock(selected.route.summary.arrivalAt) && (
                                <Text style={styles.arrival}>
                                    {selected.searchTime ? formatRouteDateTime(selected.route.summary.arrivalAt) : formatClock(selected.route.summary.arrivalAt)} 도착 예정
                                </Text>
                            )}
                            <View style={styles.flex} />
                            <Congestion
                                congestion={selected.route.summary.congestion}
                                slot={selected.route.steps.find(step => step.type === 'SUBWAY')?.stations?.[0]}
                                compact
                            />
                        </View>

                        {selected.route.summary.departureAt && <Text style={styles.arrival}>{selected.searchTime ? formatRouteDateTime(selected.route.summary.departureAt) : formatClock(selected.route.summary.departureAt)} 출발 예정</Text>}
                        <RouteNotices summary={selected.route.summary} />
                        {selected.searchTime && selected.route.summary.slackSeconds != null && <Text style={styles.meta}>{formatArrivalSlack(selected.route.summary.slackSeconds)}</Text>}

                        <View style={styles.metaRow}>
                            {selected.route.summary.fareSource === 'ESTIMATED' && (
                                <View style={styles.estimateChip}>
                                    <Text style={styles.estimateText}>예상</Text>
                                </View>
                            )}
                            <Text style={styles.meta}>
                                {formatFare(selected.route)} · 환승 {selected.route.summary.transferCount}회
                                {selected.route.summary.walkingMinutes > 0
                                    ? ` · 도보 ${selected.route.summary.walkingMinutes}분`
                                    : ''}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.sectionRow}>
                        <Text style={styles.sectionTitle}>전체 경로</Text>
                        <Text style={styles.sectionMeta}>
                            {selected.route.steps.reduce(
                                (sum, step) =>
                                    step.type === 'SUBWAY' ? sum + Math.max(step.stops.length - 1, 0) : sum,
                                0,
                            )}
                            개역 · 환승 {selected.route.summary.transferCount}회
                        </Text>
                    </View>

                    <RouteTimeline
                        route={selected.route}
                        onSignCheck={openSignCheck}
                        {...(selected.searchTime ? { showDates: true } : {})}
                        nextTrains={(!selected.searchTime || selected.searchTime.mode === 'now') && firstSubway && <NextTrains step={firstSubway} mock={arrivals === 'none' || arrivals === 'fail' ? arrivals : undefined} />}
                    />
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },

    container: {
        flex: 1,
        backgroundColor: BACKGROUND,
    },

    header: {
        paddingHorizontal: 16,
        paddingBottom: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
        backgroundColor: WHITE,
    },

    backButton: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },

    headerTitle: {
        color: NAVY,
        fontSize: 18,
        fontWeight: '700',
    },

    content: {
        padding: 20,
        gap: 12,
    },

    map: {
        height: ROUTE_MAP_HEIGHT,
        overflow: 'hidden',
        borderRadius: 18,
        backgroundColor: '#eef1f5',
    },

    notice: {
        padding: 12,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        borderRadius: 12,
        backgroundColor: '#fff6e0',
    },

    noticeText: {
        flex: 1,
        color: '#7a5600',
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 18,
    },

    card: {
        padding: 16,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: WHITE,
    },

    title: {
        color: NAVY,
        fontSize: 19,
        fontWeight: '800',
    },

    timeRow: {
        marginTop: 8,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
    },

    time: {
        color: NAVY,
        fontSize: 24,
        fontWeight: '900',
    },

    arrival: {
        color: MINT_DEEP,
        fontSize: 13.5,
        fontWeight: '700',
    },

    metaRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },

    estimateChip: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: '#fff1cc',
    },

    estimateText: {
        color: '#9a6a00',
        fontSize: 11,
        fontWeight: '800',
    },

    meta: {
        flexShrink: 1,
        color: SECONDARY,
        fontSize: 13.5,
        fontWeight: '600',
    },

    sectionRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },

    sectionTitle: {
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
    },

    sectionMeta: {
        color: SECONDARY,
        fontSize: 13,
        fontWeight: '600',
    },

    empty: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
    },

    emptyTitle: {
        color: NAVY,
        fontSize: 17,
        fontWeight: '800',
    },

    button: {
        paddingHorizontal: 20,
        height: 46,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: NAVY,
    },

    buttonText: {
        color: WHITE,
        fontSize: 15,
        fontWeight: '700',
    },
});
