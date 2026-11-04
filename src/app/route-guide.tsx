import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import LineBadge from '@/components/route/LineBadge';
import { formatFare } from '@/components/route/RouteCard';
import { getSelectedRoute } from '@/stores/route-store';

const NAVY = '#0f1c3f';
const MINT_DEEP = '#12a77a';
const BACKGROUND = '#f3f5f8';
const WHITE = '#ffffff';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';

/**
 * 경로 안내 화면 (#34 에서는 선택한 경로를 받는 것까지)
 *
 * TODO: 현재 이동 단계 카드, 표지판 방향 확인 연결 등 상세 안내 UI(그림 21)는 후속 이슈에서 구현합니다.
 */
export default function RouteGuideScreen() {
    const insets = useSafeAreaInsets();
    const { routeId } = useLocalSearchParams<{ routeId?: string }>();
    const selected = getSelectedRoute(routeId);

    const goBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/route-search');
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
                    <View style={styles.card}>
                        <Text style={styles.title}>
                            {selected.origin.name} → {selected.destination.name}
                        </Text>
                        <Text style={styles.summary}>
                            {Math.round(selected.route.summary.totalTimeSec / 60)}분 ·{' '}
                            {selected.route.summary.fareSource === 'ESTIMATED' ? '예상 ' : ''}
                            {formatFare(selected.route)} · 환승 {selected.route.summary.transferCount}회
                            {selected.route.summary.walkingMinutes > 0
                                ? ` · 도보 ${selected.route.summary.walkingMinutes}분`
                                : ''}
                        </Text>
                    </View>

                    <Text style={styles.sectionTitle}>전체 경로</Text>

                    <View style={styles.card}>
                        {selected.route.steps.map((step, index) => (
                            <View key={`${selected.route.routeId}-${index}`} style={styles.step}>
                                {step.type === 'SUBWAY' ? (
                                    <LineBadge line={step.line} />
                                ) : (
                                    <Ionicons name="walk-outline" size={18} color={MINT_DEEP} />
                                )}
                                <Text style={styles.stepText}>{step.guidance}</Text>
                            </View>
                        ))}
                    </View>
                </ScrollView>
            )}
        </View>
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

    card: {
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: WHITE,
    },

    title: {
        color: NAVY,
        fontSize: 19,
        fontWeight: '800',
    },

    summary: {
        marginTop: 8,
        color: SECONDARY,
        fontSize: 13.5,
        fontWeight: '600',
    },

    sectionTitle: {
        marginTop: 8,
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
    },

    step: {
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },

    stepText: {
        flex: 1,
        color: NAVY,
        fontSize: 14,
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
