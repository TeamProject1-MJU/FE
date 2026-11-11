import { formatStationName } from '@/utils/station-name';
import { useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import LineBadge from '@/components/route/LineBadge';
import { buildSamples, checkDirection, LINE_COLORS, type Sample, type SampleSign } from '@/services/direction';
import { getSelectedRoute } from '@/stores/route-store';
import {
    DirectionCheckError,
    type DirectionCheckResponse,
    type DirectionCode,
    type DirectionErrorCode,
} from '@/types/direction';

const NAVY = '#0f1c3f';
const CAMERA_BG = '#0b1226';
const MINT = '#2bcf9a';
const MINT_DEEP = '#12a77a';
const AI = '#6a5ae0';
const RED = '#e5484d';
const AMBER = '#b7791f';
const WHITE = '#ffffff';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const BACKGROUND = '#f3f5f8';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Phase =
    | { kind: 'waiting' }
    | { kind: 'preview'; sample: Sample }
    | { kind: 'analyzing'; sample: Sample }
    | { kind: 'result'; sample: Sample; data: DirectionCheckResponse }
    | { kind: 'error'; sample: Sample; code: DirectionErrorCode };

/** 경로 없이 열었을 때 쓰는 예시 경로 (명세 9.1 예시) */
const EXAMPLE_ROUTE = {
    stationId: 105,
    stationName: '강남',
    lineId: 2,
    lineName: '2호선',
    direction: 'INNER' as DirectionCode,
    headsign: '사당 방면',
};

const ERROR_TEXT: Record<DirectionErrorCode, string> = {
    AI_UNAVAILABLE: 'AI가 잠시 응답하지 않아요. 잠시 후 다시 시도해 주세요.',
    AI_QUOTA_EXCEEDED: '오늘 사용할 수 있는 분석 횟수를 모두 사용했어요.',
    IMAGE_INVALID: '사진 형식을 확인해 주세요. JPG·PNG 사진만 분석할 수 있어요.',
    NETWORK_ERROR: '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
};

/**
 * AI 표지판 방향 확인 (#37, 상세설계서 그림 22~25, API 명세 9.1)
 *
 * 경로 안내 화면의 '표지판으로 방향 확인'에서 route 파트 값(stationId·lineId·direction·headsign)을 받아 엽니다.
 * 지금은 실제 카메라·앨범·업로드·AI 분석 없이 예시 사진으로 결과 흐름만 확인합니다.
 * TODO: expo-image-picker 촬영·선택 + POST /ai/direction-check 연동
 */
export default function AiDirectionScreen() {
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{
        stationId?: string;
        stationName?: string;
        lineId?: string;
        lineName?: string;
        direction?: string;
        headsign?: string;
    }>();

    const fromRoute = !!params.stationId && !!params.lineId && !!params.headsign;
    const expected = fromRoute
        ? {
            stationId: Number(params.stationId),
            stationName: params.stationName ?? '',
            lineId: Number(params.lineId),
            lineName: params.lineName ?? `${params.lineId}호선`,
            // 방향 코드를 모르면 생략하고 headsign 으로 비교 (명세 9.1)
            direction: (params.direction || undefined) as DirectionCode | undefined,
            headsign: params.headsign ?? '',
        }
        : EXAMPLE_ROUTE;

    const line = { id: expected.lineId, name: expected.lineName, color: LINE_COLORS[expected.lineId] ?? null };

    // 선택한 경로에서 이 승차 구간을 찾아 '몇 개 역, 몇 분 후 어디서 하차'를 보여줍니다.
    const ride = useMemo(() => {
        const step = getSelectedRoute()?.route.steps.find(
            item =>
                item.type === 'SUBWAY' && item.stops[0]?.id === expected.stationId && item.line?.id === expected.lineId,
        );
        if (!step) return null;
        return {
            stops: Math.max(step.stops.length - 1, 0),
            minutes: Math.max(1, Math.round(step.durationSec / 60)),
            alightName: step.stops.at(-1)?.name ?? '',
        };
    }, [expected.stationId, expected.lineId]);

    const samples = useMemo(() => buildSamples(expected), [expected.stationId, expected.lineId, expected.headsign]);

    const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
    const [pickerOpen, setPickerOpen] = useState(false);

    const goBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/home');
    };

    const analyze = async (sample: Sample) => {
        setPhase({ kind: 'analyzing', sample });
        try {
            const data = await checkDirection(sample, expected);
            setPhase({ kind: 'result', sample, data });
        } catch (error) {
            const code = error instanceof DirectionCheckError ? error.code : 'NETWORK_ERROR';
            setPhase({ kind: 'error', sample, code });
        }
    };

    const pickSample = (sample: Sample) => {
        setPickerOpen(false);
        setPhase({ kind: 'preview', sample });
    };

    const restart = () => {
        setPhase({ kind: 'waiting' });
        setPickerOpen(true);
    };

    const shownSign = phase.kind === 'waiting' ? null : phase.sample.sign;

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {/* 헤더 */}
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <Pressable style={styles.headerButton} onPress={goBack} accessibilityLabel="닫기">
                    <Ionicons name="close" size={24} color={WHITE} />
                </Pressable>
                <Text style={styles.headerTitle}>AI 방향 안내</Text>
                <View style={styles.headerButton} />
            </View>

            {/* 내 경로 (명세 9.1 route 파트) */}
            <View style={styles.routeChip}>
                <Text style={styles.routeChipLabel}>{fromRoute ? '내 경로' : '예시 경로'}</Text>
                <LineBadge line={line} size={18} />
                <Text style={styles.routeChipText} numberOfLines={1}>
                    {formatStationName(expected.stationName)} · {expected.lineName} {expected.headsign}
                </Text>
            </View>

            {/* 카메라 영역 (지금은 예시 사진) */}
            <View style={styles.cameraArea}>
                <View style={styles.frame}>
                    <Corner position="topLeft" />
                    <Corner position="topRight" />
                    <Corner position="bottomLeft" />
                    <Corner position="bottomRight" />

                    {shownSign ? <SignPlate sign={shownSign} /> : <Ionicons name="scan-outline" size={54} color="rgba(255,255,255,0.35)" />}
                    {phase.kind === 'analyzing' && <ScanLine />}
                </View>

                <View style={styles.guide}>
                    <Ionicons name="scan-circle-outline" size={16} color={WHITE} />
                    <Text style={styles.guideText}>
                        {phase.kind === 'analyzing'
                            ? 'AI가 표지판을 읽고 있어요'
                            : '표지판이 네모 안에 들어오게 맞춰주세요'}
                    </Text>
                </View>
            </View>

            {/* 아래 패널 */}
            <View style={[styles.panel, { paddingBottom: insets.bottom + 18 }]}>
                <ScrollView bounces={false} contentContainerStyle={styles.panelContent}>
                    {phase.kind === 'waiting' && (
                        <>
                            <Text style={styles.panelTitle}>표지판을 찍어 방향을 확인해요</Text>
                            <Text style={styles.panelText}>역 이름·노선·방면이 보이게 찍으면 AI가 내 경로와 비교해요.</Text>
                            <View style={styles.buttonRow}>
                                <ActionButton icon="camera" label="표지판 촬영" onPress={() => setPickerOpen(true)} />
                                <ActionButton
                                    icon="image-outline"
                                    label="사진 업로드"
                                    variant="outline"
                                    onPress={() => setPickerOpen(true)}
                                />
                            </View>
                            <MockNotice />
                        </>
                    )}

                    {phase.kind === 'preview' && (
                        <>
                            <View style={styles.row}>
                                <Text style={styles.panelTitle}>이 사진으로 확인할까요?</Text>
                                <View style={styles.flex} />
                                <View style={styles.sampleTag}>
                                    <Text style={styles.sampleTagText}>예시 · {phase.sample.title}</Text>
                                </View>
                            </View>
                            <Text style={styles.panelText}>사진은 분석에만 쓰고 저장하지 않아요.</Text>
                            <View style={styles.buttonRow}>
                                <ActionButton icon="sparkles" label="AI로 확인하기" tone="ai" onPress={() => analyze(phase.sample)} />
                                <ActionButton icon="refresh" label="다시 선택" variant="outline" onPress={restart} />
                            </View>
                        </>
                    )}

                    {phase.kind === 'analyzing' && (
                        <View style={styles.analyzing}>
                            <ActivityIndicator color={AI} />
                            <Text style={styles.panelTitle}>AI가 표지판을 읽고 있어요</Text>
                            <Text style={styles.panelText}>역 이름·노선·방면을 내 경로와 비교하는 중이에요.</Text>
                        </View>
                    )}

                    {phase.kind === 'result' && (
                        <ResultPanel
                            data={phase.data}
                            line={line}
                            ride={ride}
                            fromRoute={fromRoute}
                            onRetake={restart}
                            onBack={goBack}
                        />
                    )}

                    {phase.kind === 'error' && (
                        <View>
                            <StatusTitle icon="cloud-offline-outline" color={SECONDARY} title="분석하지 못했어요" />
                            <Text style={styles.message}>{ERROR_TEXT[phase.code]}</Text>
                            <View style={styles.buttonRow}>
                                <ActionButton icon="refresh" label="다시 시도" onPress={() => analyze(phase.sample)} />
                                <ActionButton icon="images-outline" label="다른 사진" variant="outline" onPress={restart} />
                            </View>
                        </View>
                    )}
                </ScrollView>
            </View>

            {/* 예시 사진 선택 시트 */}
            {pickerOpen && (
                <View style={styles.sheetLayer}>
                    <Pressable style={styles.dim} onPress={() => setPickerOpen(false)} accessibilityLabel="닫기" />
                    <View style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
                        <View style={styles.sheetHandle} />
                        <View style={styles.row}>
                            <Text style={styles.panelTitle}>예시 사진 선택</Text>
                            <View style={styles.flex} />
                            <View style={styles.testTag}>
                                <Text style={styles.testTagText}>테스트용</Text>
                            </View>
                        </View>
                        <Text style={styles.panelText}>
                            실제 촬영·앨범 대신 예시 사진으로 결과 화면을 확인해요.
                        </Text>
                        <View style={styles.sampleGrid}>
                            {samples.map(sample => (
                                <Pressable
                                    key={sample.id}
                                    style={({ pressed }) => [styles.sampleCard, pressed && styles.pressed]}
                                    onPress={() => pickSample(sample)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`예시 사진 ${sample.title}`}
                                >
                                    <View style={styles.sampleThumb}>
                                        <SignPlate sign={sample.sign} small />
                                    </View>
                                    <Text style={styles.sampleTitle}>{sample.title}</Text>
                                    <Text style={styles.sampleCaption}>{sample.caption}</Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>
                </View>
            )}
        </View>
    );
}

/* ---------- 결과 (그림 23~25) ---------- */

function ResultPanel({
                         data,
                         line,
                         ride,
                         fromRoute,
                         onRetake,
                         onBack,
                     }: {
    data: DirectionCheckResponse;
    line: { id: number; name: string; color: string | null };
    ride: { stops: number; minutes: number; alightName: string } | null;
    fromRoute: boolean;
    onRetake: () => void;
    onBack: () => void;
}) {
    const backLabel = fromRoute ? '경로 안내로 돌아가기' : '닫기';

    if (data.result === 'RETAKE') {
        const title =
            data.reason === 'NOT_A_SIGN'
                ? '표지판이 아닌 것 같아요'
                : data.reason === 'MISSING_INFO'
                    ? '방면 정보가 보이지 않아요'
                    : '표지판을 읽기 어려워요';
        return (
            <View>
                <StatusTitle icon="camera-reverse-outline" color={AMBER} title={title} />
                <Text style={styles.message}>{data.message}</Text>
                <View style={styles.tips}>
                    {['표지판 전체가 네모 안에 들어오게', '글자가 흐리지 않게 가까이에서', '빛 반사가 없는 각도로'].map(tip => (
                        <View key={tip} style={styles.tipRow}>
                            <Ionicons name="checkmark" size={15} color={MINT_DEEP} />
                            <Text style={styles.tipText}>{tip}</Text>
                        </View>
                    ))}
                </View>
                <View style={styles.buttonRow}>
                    <ActionButton icon="camera" label="다시 촬영" onPress={onRetake} />
                </View>
            </View>
        );
    }

    const correct = data.result === 'CORRECT';
    const wrongLine = data.reason === 'LINE_NOT_ON_ROUTE';
    const title = correct ? '올바른 방향이에요' : wrongLine ? '경로에 없는 노선이에요' : '반대 방향이에요';

    return (
        <View>
            <View style={styles.row}>
                <StatusTitle
                    icon={correct ? 'checkmark-circle' : 'close-circle'}
                    color={correct ? MINT_DEEP : RED}
                    title={title}
                />
                <View style={styles.flex} />
                <View style={styles.aiChip}>
                    <Ionicons name="sparkles" size={11} color={AI} />
                    <Text style={styles.aiChipText}>AI 분석</Text>
                </View>
            </View>
            <Text style={styles.message}>{data.message}</Text>

            {/* 인식 결과 vs 내 경로 */}
            <View style={styles.grid}>
                <Cell label="현재 역" value={formatStationName(data.recognized.stationName) || '-'} />
                <Cell label="인식한 노선" value={data.recognized.lineName ?? '-'} bad={wrongLine} />
                <Cell label="인식한 방면" value={data.recognized.headsign ?? '-'} bad={!correct && !wrongLine} good={correct} />
                <Cell label="내 경로 방면" value={`${data.expected.lineName ?? ''} ${data.expected.headsign ?? ''}`} />
            </View>

            {/* 이동 안내 */}
            <View style={[styles.guideCard, correct ? styles.guideCardOk : styles.guideCardBad]}>
                <View style={[styles.guideIcon, { backgroundColor: correct ? MINT : RED }]}>
                    <Ionicons name={correct ? 'arrow-forward' : 'alert'} size={20} color={WHITE} />
                </View>
                <View style={styles.flex}>
                    {correct ? (
                        <>
                            <View style={styles.row}>
                                <LineBadge line={line} size={17} />
                                <Text style={styles.guideTitle}> {data.expected.headsign} 열차를 타세요</Text>
                            </View>
                            {ride && (
                                <Text style={styles.guideSub}>
                                    {ride.stops}개역 · {ride.minutes}분 후 {formatStationName(ride.alightName)}에서 하차
                                </Text>
                            )}
                        </>
                    ) : (
                        // 상세설계서 그림 24: 잘못된 방향임을 빨간색으로 알리고, 내 경로의 노선·방면만 다시 보여줍니다.
                        <>
                            <Text style={styles.guideTitle}>
                                {wrongLine ? '이 노선은 내 경로에 없어요' : '이 방면은 내 경로와 반대예요'}
                            </Text>
                            <Text style={styles.guideSub}>
                                내 경로: {data.expected.lineName} {data.expected.headsign}
                            </Text>
                        </>
                    )}
                </View>
            </View>

            <View style={styles.buttonRow}>
                {correct ? (
                    <ActionButton icon="map-outline" label={backLabel} onPress={onBack} />
                ) : (
                    <>
                        <ActionButton icon="camera" label="다시 확인" onPress={onRetake} />
                        <ActionButton icon="map-outline" label={fromRoute ? '경로 안내' : '닫기'} variant="outline" onPress={onBack} />
                    </>
                )}
            </View>

            {correct && (
                <Pressable onPress={onRetake} style={styles.retryLink} accessibilityRole="button">
                    <Text style={styles.retryText}>
                        인식 결과가 다른가요? <Text style={styles.retryStrong}>다시 촬영하기</Text>
                    </Text>
                </Pressable>
            )}
        </View>
    );
}

/* ---------- 작은 부품 ---------- */

function StatusTitle({ icon, color, title }: { icon: IconName; color: string; title: string }) {
    return (
        <View style={styles.statusRow}>
            <Ionicons name={icon} size={22} color={color} />
            <Text style={[styles.statusTitle, { color }]}>{title}</Text>
        </View>
    );
}

function Cell({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
    return (
        <View style={styles.cell}>
            <Text style={styles.cellLabel}>{label}</Text>
            <Text style={[styles.cellValue, good && { color: MINT_DEEP }, bad && { color: RED }]} numberOfLines={1}>
                {value}
            </Text>
        </View>
    );
}

function ActionButton({
                          icon,
                          label,
                          onPress,
                          variant = 'fill',
                          tone = 'navy',
                      }: {
    icon: IconName;
    label: string;
    onPress: () => void;
    variant?: 'fill' | 'outline';
    tone?: 'navy' | 'ai';
}) {
    const fill = variant === 'fill';
    const color = tone === 'ai' ? AI : NAVY;
    return (
        <Pressable
            style={({ pressed }) => [
                styles.action,
                fill ? { backgroundColor: color } : { borderWidth: 1.5, borderColor: color, backgroundColor: WHITE },
                pressed && styles.pressed,
            ]}
            onPress={onPress}
            accessibilityRole="button"
        >
            <Ionicons name={icon} size={18} color={fill ? WHITE : color} />
            <Text style={[styles.actionText, { color: fill ? WHITE : color }]}>{label}</Text>
        </Pressable>
    );
}

function MockNotice() {
    return (
        <View style={styles.notice}>
            <Ionicons name="flask-outline" size={16} color="#7a5600" />
            <Text style={styles.noticeText}>
                테스트 버전이에요. 실제 카메라·앨범 대신 예시 사진으로 확인하고, 사진은 저장하지 않아요.
            </Text>
        </View>
    );
}

/** 승강장 표지판 그림 (예시 사진 대신) */
function SignPlate({ sign, small = false }: { sign: SampleSign; small?: boolean }) {
    const scale = small ? 0.52 : 1;
    const color = sign.lineId != null ? LINE_COLORS[sign.lineId] : '#888';
    return (
        <View style={[styles.sign, { transform: [{ scale }] }]}>
            <View style={[styles.signBadge, { backgroundColor: color }]}>
                <Text style={styles.signBadgeText}>{sign.lineId ?? '?'}</Text>
            </View>
            <View style={styles.flex}>
                <Text style={styles.signHeadsign} numberOfLines={1}>
                    {sign.headsign}
                </Text>
                <Text style={styles.signLine}>{sign.lineName}</Text>
            </View>
            <Text style={styles.signArrow}>→</Text>
            {sign.blurred && <View style={styles.blur} />}
        </View>
    );
}

function Corner({ position }: { position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' }) {
    return <View style={[styles.corner, styles[position]]} />;
}

function ScanLine() {
    const progress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const loop = Animated.loop(
            Animated.timing(progress, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        );
        loop.start();
        return () => loop.stop();
    }, [progress]);

    return (
        <Animated.View
            style={[
                styles.scanLine,
                { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-70, 70] }) }] },
            ]}
        />
    );
}

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },

    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },

    container: {
        flex: 1,
        backgroundColor: CAMERA_BG,
    },

    header: {
        paddingHorizontal: 12,
        paddingBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },

    headerButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },

    headerTitle: {
        color: WHITE,
        fontSize: 17,
        fontWeight: '800',
    },

    routeChip: {
        marginHorizontal: 20,
        paddingHorizontal: 12,
        paddingVertical: 9,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.1)',
    },

    routeChipLabel: {
        color: MINT,
        fontSize: 12,
        fontWeight: '800',
    },

    routeChipText: {
        flex: 1,
        color: WHITE,
        fontSize: 13.5,
        fontWeight: '700',
    },

    cameraArea: {
        flex: 1,
        minHeight: 220,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
    },

    frame: {
        width: '82%',
        height: 170,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },

    corner: {
        position: 'absolute',
        width: 28,
        height: 28,
        borderColor: MINT,
    },

    topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 },
    topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 10 },
    bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 10 },
    bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 10 },

    scanLine: {
        position: 'absolute',
        left: 12,
        right: 12,
        height: 3,
        borderRadius: 2,
        backgroundColor: MINT,
        opacity: 0.85,
    },

    guide: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.12)',
    },

    guideText: {
        color: WHITE,
        fontSize: 13,
        fontWeight: '600',
    },

    sign: {
        width: 260,
        paddingHorizontal: 14,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        overflow: 'hidden',
        borderRadius: 10,
        backgroundColor: '#1d2433',
    },

    signBadge: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },

    signBadgeText: {
        color: WHITE,
        fontSize: 18,
        fontWeight: '900',
    },

    signHeadsign: {
        color: WHITE,
        fontSize: 20,
        fontWeight: '800',
    },

    signLine: {
        marginTop: 2,
        color: '#aab3c5',
        fontSize: 12,
        fontWeight: '600',
    },

    signArrow: {
        color: WHITE,
        fontSize: 26,
        fontWeight: '900',
    },

    blur: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(160,170,185,0.72)',
    },

    panel: {
        maxHeight: '62%',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: WHITE,
    },

    panelContent: {
        paddingHorizontal: 20,
        paddingTop: 22,
    },

    panelTitle: {
        color: NAVY,
        fontSize: 18,
        fontWeight: '800',
    },

    panelText: {
        marginTop: 6,
        color: SECONDARY,
        fontSize: 13.5,
        fontWeight: '500',
        lineHeight: 19,
    },

    buttonRow: {
        marginTop: 16,
        flexDirection: 'row',
        gap: 8,
    },

    action: {
        flex: 1,
        height: 50,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderRadius: 14,
    },

    actionText: {
        fontSize: 15,
        fontWeight: '800',
    },

    notice: {
        marginTop: 14,
        padding: 11,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 7,
        borderRadius: 11,
        backgroundColor: '#fff6e0',
    },

    noticeText: {
        flex: 1,
        color: '#7a5600',
        fontSize: 12.5,
        fontWeight: '600',
        lineHeight: 17,
    },

    sampleTag: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 7,
        backgroundColor: '#fff1cc',
    },

    sampleTagText: {
        color: '#7a5600',
        fontSize: 11.5,
        fontWeight: '800',
    },

    analyzing: {
        paddingVertical: 12,
        alignItems: 'center',
        gap: 6,
    },

    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },

    statusTitle: {
        fontSize: 19,
        fontWeight: '900',
    },

    aiChip: {
        paddingHorizontal: 7,
        paddingVertical: 3,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        borderRadius: 7,
        backgroundColor: '#efedfd',
    },

    aiChipText: {
        color: AI,
        fontSize: 11,
        fontWeight: '800',
    },

    message: {
        marginTop: 6,
        color: '#4b5468',
        fontSize: 14,
        fontWeight: '600',
        lineHeight: 20,
    },

    grid: {
        marginTop: 14,
        flexDirection: 'row',
        flexWrap: 'wrap',
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 14,
        overflow: 'hidden',
    },

    cell: {
        width: '50%',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderColor: BORDER,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },

    cellLabel: {
        color: SECONDARY,
        fontSize: 12,
        fontWeight: '600',
    },

    cellValue: {
        marginTop: 3,
        color: NAVY,
        fontSize: 15,
        fontWeight: '800',
    },

    guideCard: {
        marginTop: 12,
        padding: 13,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: 14,
    },

    guideCardOk: {
        backgroundColor: '#e9f9f2',
    },

    guideCardBad: {
        backgroundColor: '#fdecec',
    },

    guideIcon: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
    },

    guideTitle: {
        color: NAVY,
        fontSize: 15,
        fontWeight: '800',
    },

    guideSub: {
        marginTop: 3,
        color: '#4b5468',
        fontSize: 13,
        fontWeight: '600',
    },

    tips: {
        marginTop: 12,
        padding: 12,
        gap: 6,
        borderRadius: 12,
        backgroundColor: BACKGROUND,
    },

    tipRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },

    tipText: {
        color: '#4b5468',
        fontSize: 13.5,
        fontWeight: '600',
    },

    retryLink: {
        marginTop: 12,
        alignItems: 'center',
    },

    retryText: {
        color: SECONDARY,
        fontSize: 13,
        fontWeight: '600',
    },

    retryStrong: {
        color: NAVY,
        fontWeight: '800',
        textDecorationLine: 'underline',
    },

    sheetLayer: {
        ...StyleSheet.absoluteFill,
        justifyContent: 'flex-end',
    },

    dim: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(0,0,0,0.45)',
    },

    sheet: {
        paddingHorizontal: 20,
        paddingTop: 10,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: WHITE,
    },

    sheetHandle: {
        width: 40,
        height: 4,
        marginBottom: 14,
        alignSelf: 'center',
        borderRadius: 2,
        backgroundColor: '#d9dde4',
    },

    testTag: {
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 7,
        backgroundColor: '#fff1cc',
    },

    testTagText: {
        color: '#7a5600',
        fontSize: 11,
        fontWeight: '800',
    },

    sampleGrid: {
        marginTop: 14,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },

    sampleCard: {
        width: '47.5%',
        padding: 10,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 14,
        backgroundColor: WHITE,
    },

    sampleThumb: {
        height: 64,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: 10,
        backgroundColor: CAMERA_BG,
    },

    sampleTitle: {
        marginTop: 8,
        color: NAVY,
        fontSize: 14,
        fontWeight: '800',
    },

    sampleCaption: {
        marginTop: 2,
        color: SECONDARY,
        fontSize: 12,
        fontWeight: '600',
    },

    pressed: {
        opacity: 0.72,
    },
});