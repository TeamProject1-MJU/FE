import RouteNotices from '@/components/route/RouteNotices';
import { formatStationName } from '@/utils/station-name';
import { formatClock, formatTotalTime } from '@/components/route/format';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import Congestion from '@/components/route/Congestion';
import NextTrains from '@/components/route/NextTrains';
import { formatFare } from '@/components/route/RouteCard';
import RouteMapPreview from '@/components/route/RouteMapPreview';
import RouteTimeline from '@/components/route/RouteTimeline';
import { getSelectedRoute } from '@/stores/route-store';
import type { RouteStep } from '@/types/route';

const NAVY = '#0f1c3f';
const MINT_DEEP = '#12a77a';
const BACKGROUND = '#f3f5f8';
const WHITE = '#ffffff';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';

/**
 * 경로 안내 화면 (#35, 상세설계서 그림 21)
 *
 * 명세 6.1: 별도 경로 안내 API 없음. 경로 탐색에서 고른 route 객체를 그대로 받아
 * route.steps 의 guidance·line·direction·stops 를 그립니다.
 * TODO: 현재 이동 단계(step index) 추적·실시간 위치 안내는 후속 이슈에서 구현합니다.
 */
export default function RouteGuideScreen() {
    const insets = useSafeAreaInsets();
    const { routeId, arrivals } = useLocalSearchParams<{ routeId?: string; arrivals?: string }>();
    const selected = getSelectedRoute(routeId);
    const firstSubway = selected?.route.steps.find(step => step.type === 'SUBWAY');

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
            ) : (
                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
                    {selected.routeSource === 'INTERNAL' && (
                        <View style={styles.notice}>
                            <Ionicons name="information-circle-outline" size={18} color="#9a6a00" />
                            <Text style={styles.noticeText}>
                                실시간 경로를 불러오지 못해 자체 계산한 경로를 보여드려요. 요금은 예상 금액이에요.
                            </Text>
                        </View>
                    )}

                    <RouteMapPreview route={selected.route} />

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
                                    {formatClock(selected.route.summary.arrivalAt)} 도착 예정
                                </Text>
                            )}
                            <View style={styles.flex} />
                            <Congestion
                                congestion={selected.route.summary.congestion}
                                slot={selected.route.steps.find(step => step.type === 'SUBWAY')?.stations?.[0]}
                                compact
                            />
                        </View>

                        {selected.route.summary.departureAt && <Text style={styles.arrival}>{formatClock(selected.route.summary.departureAt)} 출발 예정</Text>}
                        <RouteNotices summary={selected.route.summary} />

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
                        nextTrains={firstSubway && <NextTrains step={firstSubway} mock={arrivals === 'none' || arrivals === 'fail' ? arrivals : undefined} />}
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
