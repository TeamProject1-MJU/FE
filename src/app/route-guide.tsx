import { useState } from 'react';
import RouteNotices from '@/components/route/RouteNotices';
import RouteTimeNotice from '@/components/route/RouteTimeNotice';
import { formatArrivalSlack, formatRouteRelativeDateTime, formatRouteTimeSelection, shouldShowLiveTrains } from '@/utils/route-time';
import { formatStationName } from '@/utils/station-name';
import { directionInputFromStep, directionStepIssue, normalizeDirectionRoute } from '@/utils/direction-route';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/app-text';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import KakaoMap from '@/components/KakaoMap';
import NextTrains from '@/components/route/NextTrains';
import { formatFare, splitTotalTime } from '@/components/route/RouteCard';
import RouteMapLegend from '@/components/route/RouteMapLegend';
import RouteMapPreview from '@/components/route/RouteMapPreview';
import RouteTimeline, { congestionMark } from '@/components/route/RouteTimeline';
import { useRouteMap } from '@/hooks/use-route-map';
import { useMock as isMockMode } from '@/services/api/config';
import { getSessionGeneration } from '@/services/auth';
import { getAuthStatus, getSession } from '@/stores/auth-store';
import { getSelectedRoute } from '@/stores/route-store';
import type { RouteStep } from '@/types/route';

// 라벤더 시안(#196) "경로 안내"
const LV_TEXT = '#25212D';
const LV_SECONDARY = '#83808B';
const LV_MAIN = '#5C3F78';
const LV_BACKGROUND = '#F7F5FA';
const LV_WHITE = '#FFFFFF';
const LV_CARD_BORDER = '#EEEAF2';
const LV_SOFT = '#EDE8F3';
const LV_CELL_BORDER = '#E8E3EE';
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
    const [mapExpanded, setMapExpanded] = useState(true);
    const { routeId, arrivals } = useLocalSearchParams<{ routeId?: string; arrivals?: string }>();
    const selected = getSelectedRoute(routeId);
    const firstSubway = selected?.route.steps.find(step => step.type === 'SUBWAY');
    const showLiveTrains = !!selected && shouldShowLiveTrains(selected);
    /** 약속 기준(또는 기준을 모르는) 약속방 경로에서 실시간 열차를 뺀 이유예요 (#172). 개인 시각 지정은 검색 조건 안내가 따로 있어요. */
    const liveTrainsNotice = selected?.timeBasis === 'appointment'
        ? '약속 시각 기준 경로라 현재 실시간 열차는 표시하지 않아요.'
        : selected?.timeBasis === 'unknown' ? '약속 정보를 확인하지 못해 현재 실시간 열차는 표시하지 않아요.' : null;
    const serverMode = !isMockMode();
    const routeMap = useRouteMap(selected?.route ?? null, serverMode, currentAccount());

    const goBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/route-search');
    };

    /** 승차 구간 → 표지판 방향 확인 (명세 9.1 route 파트에 넣을 값을 함께 넘깁니다) */
    const openSignCheck = (step: RouteStep) => {
        const station = step.stops[0];
        if (serverMode) {
            if (directionStepIssue(step)) return;
            const route = normalizeDirectionRoute(directionInputFromStep(step));
            if (!route) return;
            router.push({ pathname: '/ai-direction', params: {
                stationId: String(route.stationId), stationName: station?.name ?? '',
                lineId: String(route.lineId), lineName: step.line?.name ?? '',
                ...(route.direction ? { direction: route.direction } : {}), ...(route.headsign ? { headsign: route.headsign } : {}),
            } });
            return;
        }
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

    /** 위쪽 오른쪽 계산 기준. 앱이 가진 searchTime·timeBasis 로만 정하고, 알 수 없으면 표시하지 않아요. */
    const conditionLabel = !selected ? null
        : selected.searchTime ? formatRouteTimeSelection(selected.searchTime)
            : selected.timeBasis === 'now' ? '지금 출발'
                : selected.timeBasis === 'appointment' ? '약속 시각 기준' : null;

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            <View style={[styles.header, { paddingTop: insets.top }]}>
                <Pressable style={styles.backButton} onPress={goBack} accessibilityLabel="뒤로 가기">
                    <Ionicons name="chevron-back" size={24} color={LV_TEXT} />
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
                    {selected.searchTime && <RouteTimeNotice compact selection={selected.searchTime} routes={selected.origin.id === selected.destination.id ? [] : [selected.route]} mock={isMockMode()} />}
                    {selected.appointmentPassed && !!selected.notice && (
                        <View style={styles.notice}>
                            <Ionicons name="alert-circle-outline" size={17} color={LV_MAIN} />
                            <Text style={styles.noticeText}>{selected.notice}</Text>
                        </View>
                    )}
                    {selected.routeSource === 'INTERNAL' && (
                        <View style={[styles.notice, styles.inlineNotice]}>
                            <Ionicons name="information-circle-outline" size={18} color={LV_MAIN} />
                            <Text style={[styles.noticeText, styles.inlineNoticeText]}>자체 계산한 경로예요.</Text>
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
                    {/* 요약 */}
                    <View style={styles.summary}>
                        <View style={styles.routeRow}>
                            <Text style={styles.routeName} numberOfLines={1}>
                                {formatStationName(selected.origin.name)} → {formatStationName(selected.destination.name)}
                            </Text>
                            {!!conditionLabel && <Text style={styles.condition}>{conditionLabel}</Text>}
                        </View>

                        <Text style={styles.totalLine}>
                            <Text style={styles.totalPrefix}>{splitTotalTime(selected.route.summary)[0].replace('대기 포함 ', '')}</Text>
                            <Text style={styles.totalTime}>{splitTotalTime(selected.route.summary)[1]}</Text>
                            <Text style={styles.clockRange}>{'  '}{selected.route.summary.departureAt ? `${formatRouteRelativeDateTime(selected.route.summary.departureAt)} → ` : ''}{formatRouteRelativeDateTime(selected.route.summary.arrivalAt)} 도착</Text>
                        </Text>

                        <View style={styles.metaRow}>
                            <View style={styles.metaCell}>
                                <Text style={styles.metaLabel}>요금</Text>
                                <Text style={styles.metaValue}>{selected.route.summary.fareSource === 'ESTIMATED' ? '예상 ' : ''}{formatFare(selected.route)}</Text>
                            </View>
                            <View style={[styles.metaCell, styles.metaCellDivider]}>
                                <Text style={styles.metaLabel}>환승</Text>
                                <Text style={styles.metaValue}>{selected.route.summary.transferCount}회</Text>
                            </View>
                            {selected.route.summary.walkingMinutes > 0 && <View style={[styles.metaCell, styles.metaCellDivider]}>
                                <Text style={styles.metaLabel}>도보</Text>
                                <Text style={styles.metaValue}>{selected.route.summary.walkingMinutes}분</Text>
                            </View>}
                        </View>
                        {selected.route.summary.congestion.supported && selected.route.summary.congestion.level && (
                                <View style={styles.summaryCongestion}>
                                    {congestionMark(selected.route.summary.congestion, {
                                        compact: true,
                                        slot: selected.route.steps.find(step => step.type === 'SUBWAY')?.stations?.[0],
                                        size: 12,
                                    })}
                                </View>
                        )}
                        <RouteNotices summary={selected.route.summary} />
                        {selected.searchTime && selected.route.summary.slackSeconds != null && <Text style={styles.meta}>{formatArrivalSlack(selected.route.summary.slackSeconds)}</Text>}
                        {/* 안내 문구 */}
                        {selected.searchTime && <RouteTimeNotice compact selection={selected.searchTime} routes={selected.origin.id === selected.destination.id ? [] : [selected.route]} mock={isMockMode()} />}
                        {selected.appointmentPassed && !!selected.notice && (
                            <View style={styles.notice}>
                                <Ionicons name="alert-circle-outline" size={17} color={LV_MAIN} />
                                <Text style={styles.noticeText}>{selected.notice}</Text>
                            </View>
                        )}
                        {!!liveTrainsNotice && (
                            <View style={styles.notice}>
                                <Ionicons name="information-circle-outline" size={18} color={LV_MAIN} />
                                <Text style={styles.noticeText}>{liveTrainsNotice}</Text>
                            </View>
                        )}

                        {selected.routeSource === 'INTERNAL' && (
                            <View style={[styles.notice, styles.inlineNotice]}>
                                <Ionicons name="information-circle-outline" size={18} color={LV_MAIN} />
                                <Text style={[styles.noticeText, styles.inlineNoticeText]}>자체 계산한 경로예요.</Text>
                            </View>
                        )}
                    </View>

                    {/* 지도 미리보기 */}
                    <View style={styles.mapCard}>
                        <Pressable style={styles.mapToggle} onPress={() => setMapExpanded(value => !value)} accessibilityRole="button" accessibilityState={{ expanded: mapExpanded }}>
                            <Text style={styles.mapToggleText}>{mapExpanded ? '지도 접기' : '지도 미리보기'}</Text>
                            <Ionicons name={mapExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={LV_MAIN} />
                        </Pressable>
                        <View style={!mapExpanded ? { display: 'none' } : undefined}>
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
                                    {!routeMap.failed && <RouteMapLegend compact map={routeMap.data} />}
                                </>
                            ) : (
                                <RouteMapPreview route={selected.route} />
                            )}
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
                            개역 환승 {selected.route.summary.transferCount}회
                        </Text>
                    </View>

                    <RouteTimeline
                        route={selected.route}
                        onSignCheck={openSignCheck}
                        {...(serverMode ? { getSignCheckIssue: directionStepIssue } : {})}
                        nextTrains={showLiveTrains && firstSubway && <NextTrains step={firstSubway} mock={arrivals === 'none' || arrivals === 'fail' ? arrivals : undefined} />}
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
        backgroundColor: LV_BACKGROUND,
    },

    header: {
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: LV_BACKGROUND,
    },

    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },

    headerTitle: {
        color: LV_TEXT,
        fontSize: 15,
        fontWeight: '600',
    },

    content: {
        paddingHorizontal: 12,
        paddingTop: 4,
        gap: 12,
    },

    summary: {
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 16,
        backgroundColor: LV_WHITE,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: LV_CARD_BORDER,
    },

    routeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    routeName: {
        flex: 1,
        minWidth: 0,
        color: LV_TEXT,
        fontSize: 17,
        fontWeight: '800',
        letterSpacing: -0.5,
    },

    condition: {
        color: LV_MAIN,
        fontSize: 11,
        fontWeight: '700',
        backgroundColor: LV_SOFT,
        borderRadius: 8,
        paddingVertical: 3,
        paddingHorizontal: 8,
        overflow: 'hidden',
    },

    clockRange: { color: LV_SECONDARY, fontSize: 13.5, fontWeight: '600' },
    mapToggle: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
    mapToggleText: { fontSize: 13, fontWeight: '600', color: LV_MAIN },
    totalLine: {
        marginTop: 12,
        color: LV_TEXT,
    },

    totalPrefix: {
        color: LV_SECONDARY,
        fontSize: 13,
    },

    totalTime: {
        color: LV_MAIN,
        fontSize: 34,
        fontWeight: '800',
        letterSpacing: -1,
        lineHeight: 38,
    },

    metaRow: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: LV_BACKGROUND,
        borderRadius: 14,
        paddingVertical: 10,
    },

    metaCell: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 4 },
    metaCellDivider: { borderLeftWidth: 1, borderLeftColor: LV_CELL_BORDER },
    metaLabel: { fontSize: 11, color: LV_SECONDARY },
    metaValue: { fontSize: 14, fontWeight: '700', color: LV_TEXT },
    summaryCongestion: { marginTop: 12 },

    meta: {
        flexShrink: 1,
        marginTop: 3,
        color: LV_SECONDARY,
        fontSize: 13,
    },

    mapCard: {
        padding: 8,
        gap: 8,
        borderWidth: 1,
        borderColor: LV_CARD_BORDER,
        borderRadius: 22,
        backgroundColor: LV_WHITE,
    },

    map: {
        height: ROUTE_MAP_HEIGHT,
        overflow: 'hidden',
        borderRadius: 14,
        backgroundColor: '#EFEBF4',
    },

    inlineNotice: { padding: 0, paddingVertical: 4, backgroundColor: 'transparent' },
    inlineNoticeText: { color: LV_SECONDARY, fontSize: 12, fontWeight: '400' },
    notice: {
        padding: 12,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        borderRadius: 14,
        backgroundColor: '#EDE8F3',
    },

    noticeText: {
        flex: 1,
        color: LV_MAIN,
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 18,
    },

    card: {
        padding: 16,
        gap: 4,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: LV_CARD_BORDER,
        backgroundColor: LV_WHITE,
    },

    title: {
        color: LV_TEXT,
        fontSize: 17,
        fontWeight: '800',
    },

    sectionRow: {
        marginTop: 4,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },

    sectionTitle: {
        color: LV_TEXT,
        fontSize: 15,
        fontWeight: '700',
    },

    sectionMeta: {
        color: LV_SECONDARY,
        fontSize: 12.5,
    },

    empty: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
    },

    emptyTitle: {
        color: LV_TEXT,
        fontSize: 17,
        fontWeight: '800',
    },

    button: {
        paddingHorizontal: 20,
        height: 52,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: LV_MAIN,
    },

    buttonText: {
        color: LV_WHITE,
        fontSize: 15,
        fontWeight: '600',
    },
});
