import { formatStationName } from '@/utils/station-name';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Animated, Easing, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/app-text';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { useMock } from '@/services/api/config';
import { isAuthError } from '@/services/api/errors';
import { getSessionGeneration } from '@/services/auth';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import Passenger from '@/components/passenger';
import { DIRECTION_LABELS } from '@/components/route/format';
import { directionRouteIssue, normalizeDirectionRoute } from '@/utils/direction-route';
import { buildSamples, checkDirection, LINE_COLORS, type Sample, type SampleSign } from '@/services/direction';
import { getSelectedRoute } from '@/stores/route-store';
import {
    DirectionCheckError,
    type DirectionCheckResponse,
    type DirectionCode,
    type DirectionErrorCode,
    type DirectionPhoto,
    type DirectionCheckRoute,
} from '@/types/direction';

const INK = '#25212D';
const CAMERA_BG = '#F7F5FA';
const LAVENDER = '#B89BC7';
const PURPLE = '#5C3F78';
const AI = '#5C3F78';
const WARNING = '#8C4166';
const RETAKE_COLOR = '#725B86';
const WHITE = '#ffffff';
const SECONDARY = '#83808B';
const BORDER = '#EEEAF2';
const BACKGROUND = '#F7F5FA';

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
    STATION_NOT_FOUND: '경로를 다시 선택해 주세요.',
    VALIDATION_ERROR: '경로를 다시 선택해 주세요.',
    UNKNOWN_ERROR: '분석 응답을 확인하지 못했어요. 다시 시도해 주세요.',
    AI_UNAVAILABLE: 'AI가 잠시 응답하지 않아요. 잠시 후 다시 시도해 주세요.',
    AI_QUOTA_EXCEEDED: '오늘 사용할 수 있는 분석 횟수를 모두 사용했어요.',
    IMAGE_INVALID: '사진 형식을 확인해 주세요. JPG / PNG 사진만 분석할 수 있어요.',
    NETWORK_ERROR: '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
};

/**
 * AI 표지판 방향 확인 (#37, 상세설계서 그림 22~25, API 명세 9.1)
 *
 * 경로 안내 화면의 '표지판으로 방향 확인'에서 route 파트 값(stationId·lineId·direction·headsign)을 받아 엽니다.
 * 서버 모드는 카메라·갤러리 사진을 분석하고, mock 모드는 기존 예시 사진 흐름을 유지합니다.
 */
export default function AiDirectionScreen() {
    return useMock() ? <MockDirectionScreen /> : <ServerDirectionScreen />;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SERVER_ERROR_TEXT = {
    ...ERROR_TEXT,
    IMAGE_INVALID: '다른 사진을 선택해 주세요. JPG / PNG 5MB 이하 사진이 필요해요.',
    AI_QUOTA_EXCEEDED: '분석 요청이 많아요. 잠시 후 다시 시도해 주세요.',
};

/** 같은 사진으로 다시 보낼 수 있는 오류: 사진과 임시 파일을 화면이 열려 있는 동안 유지해요 (#125) */
const RETRYABLE_ERRORS: readonly DirectionErrorCode[] = ['AI_UNAVAILABLE', 'AI_QUOTA_EXCEEDED', 'NETWORK_ERROR', 'UNKNOWN_ERROR'];
/** 경로를 다시 골라야 하는 오류 */
const ROUTE_ERRORS: readonly DirectionErrorCode[] = ['STATION_NOT_FOUND', 'VALIDATION_ERROR'];

type ResultLook = { icon: IconName; color: string; title: string };
const RESULT_LOOK: Record<DirectionCheckResponse['result'], ResultLook> = {
    CORRECT: { icon: 'checkmark-circle', color: PURPLE, title: '맞는 방향이에요' },
    WRONG: { icon: 'close-circle', color: WARNING, title: '경로와 다른 표지판이에요' },
    RETAKE: { icon: 'camera-reverse-outline', color: RETAKE_COLOR, title: '다시 촬영해 주세요' },
};

function errorLook(code: DirectionErrorCode): { icon: IconName; color: string; title: string } {
    if (code === 'IMAGE_INVALID') return { icon: 'image-outline', color: WARNING, title: '이 사진은 분석할 수 없어요' };
    if (ROUTE_ERRORS.includes(code)) return { icon: 'map-outline', color: WARNING, title: '경로를 확인하지 못했어요' };
    return { icon: code === 'NETWORK_ERROR' ? 'cloud-offline-outline' : 'hourglass-outline', color: RETAKE_COLOR, title: '분석하지 못했어요' };
}

const COMPARE_FIELDS = [
    { key: 'stationName', label: '역 이름' },
    { key: 'lineName', label: '호선' },
    { key: 'headsign', label: '방면' },
] as const;

/** 표시 비교용: 띄어쓰기와 끝의 '역'·'방면'은 무시해요. */
const sameSign = (a: string, b: string) => {
    const normalize = (value: string) => value.replace(/\s+/g, '').replace(/(역|방면)$/, '');
    return normalize(a) === normalize(b);
};

type ServerStage = 'route' | 'picking' | 'analyzing' | 'result' | 'error' | 'photo' | 'idle';

function ServerDirectionScreen() {
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ stationId?: string; stationName?: string; lineId?: string; lineName?: string; headsign?: string; direction?: string }>();
    const routeIssue = directionRouteIssue(params);
    const normalizedRoute = normalizeDirectionRoute(params);
    const validRoute = normalizedRoute !== null;
    const route: DirectionCheckRoute = normalizedRoute ?? { stationId: 0, lineId: 0 };
    const routeKey = JSON.stringify(route);
    // 화면 표시용 값이에요. 서버로 보내는 route 에는 넣지 않아요.
    const shown = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
    const lineName = shown(params.lineName);
    const routeSummary = [formatStationName(shown(params.stationName)), [lineName, route.headsign || (route.direction ? DIRECTION_LABELS[route.direction] : '')].filter(Boolean).join(' ')].filter(Boolean).join(' / ');

    const [photo, setPhoto] = useState<DirectionPhoto | null>(null);
    const [data, setData] = useState<DirectionCheckResponse | null>(null);
    const [error, setError] = useState<DirectionErrorCode | null>(null);
    const [busy, setBusy] = useState<'pick' | 'analyze' | null>(null);
    const active = useRef(false);
    const requestId = useRef(0);
    const inFlight = useRef(false);
    const temporary = useRef(new Set<string>());
    /** 사진을 고른 계정 세대. 계정이 바뀌면 유지하던 사진으로 다시 보내지 않아요. */
    const photoGeneration = useRef(-1);
    const clean = useCallback(() => {
        for (const uri of temporary.current) {
            try { const file = new File(uri); if (file.exists) file.delete(); temporary.current.delete(uri); } catch { /* Retry cleanup at the next lifecycle boundary. */ }
        }
    }, []);
    useFocusEffect(useCallback(() => {
        active.current = true;
        setBusy(null); setPhoto(null); setData(null); setError(null);
        // 화면을 떠나면 유지하던 사진의 임시 파일도 지워요. 요청 중이면 그 요청이 끝날 때 지워요.
        return () => { active.current = false; requestId.current++; if (!inFlight.current) clean(); };
    }, [clean, routeKey]));
    useEffect(() => () => { if (!inFlight.current) clean(); }, [clean]);
    const goBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/home');
    };
    const pick = async (camera: boolean) => {
        if (inFlight.current || !validRoute) return;
        // 새 사진을 고르면 유지하던 사진과 임시 파일을 먼저 정리해요.
        inFlight.current = true; setBusy('pick'); setError(null); setData(null); setPhoto(null); clean();
        const id = ++requestId.current;
        const generation = getSessionGeneration();
        const current = () => active.current && id === requestId.current && generation === getSessionGeneration();
        try {
            const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!current()) return;
            if (!permission.granted) {
                Alert.alert('사진 접근 권한이 필요해요', '설정 앱에서 카메라 / 사진 권한을 허용해 주세요.', [
                    { text: '취소', style: 'cancel' }, { text: '설정 열기', onPress: () => { void Linking.openSettings().catch(() => Alert.alert('설정 앱에서 권한을 변경해 주세요.')); } },
                ]);
                return;
            }
            const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false, base64: false };
            const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
            if (result.canceled) return;
            const asset = result.assets[0];
            // Only delete picker-owned cache files, never an original library asset.
            if (Platform.OS !== 'web' && asset.uri.startsWith(Paths.cache.uri)) temporary.current.add(asset.uri);
            if (!current()) return;
            if (!(asset.width > 0 && asset.height > 0) || asset.width * asset.height > 50000000) throw new DirectionCheckError('IMAGE_INVALID', '');
            // Re-encode every source, including HEIC, so extension/MIME cannot disguise another format.
            for (const [edge, quality] of [[2560, 0.85], [1920, 0.7], [1280, 0.5]] as const) {
                const context = ImageManipulator.manipulate(asset.uri);
                const scale = Math.min(1, edge / Math.max(asset.width, asset.height));
                context.resize({ width: Math.max(1, Math.round(asset.width * scale)), height: Math.max(1, Math.round(asset.height * scale)) });
                const rendered = await context.renderAsync();
                let output: Awaited<ReturnType<typeof rendered.saveAsync>>;
                try { output = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality }); }
                finally { rendered.release(); context.release(); }
                if (Platform.OS !== 'web') temporary.current.add(output.uri);
                if (!current()) return;
                const blob = Platform.OS === 'web' ? await (await fetch(output.uri)).blob() : undefined;
                const size = blob ? blob.size : new File(output.uri).size;
                if (size > 0 && size <= MAX_IMAGE_BYTES) {
                    if (!current()) return;
                    photoGeneration.current = generation;
                    setPhoto({ uri: output.uri, mimeType: 'image/jpeg', fileName: 'direction.jpg', ...(blob ? { file: blob } : {}) });
                    return;
                }
            }
            throw new DirectionCheckError('IMAGE_INVALID', '');
        } catch {
            if (current()) { setError('IMAGE_INVALID'); clean(); }
        } finally {
            inFlight.current = false;
            if (current()) setBusy(null);
            else clean();
        }
    };
    /** 처음 확인과 '다시 시도' 모두 지금 들고 있는 같은 사진으로 보내요. */
    const analyze = async () => {
        if (!photo || !validRoute || inFlight.current) return;
        if (photoGeneration.current !== getSessionGeneration()) { clean(); setPhoto(null); setError(null); return; }
        inFlight.current = true; setBusy('analyze'); setError(null); setData(null);
        const id = ++requestId.current;
        const generation = getSessionGeneration();
        const mounted = () => active.current && id === requestId.current;
        const current = () => mounted() && generation === getSessionGeneration();
        let keep = false;
        try {
            const response = await checkDirection(photo, route);
            if (current()) setData(response);
        } catch (failure) {
            if (current() && !isAuthError(failure)) {
                const code = failure instanceof DirectionCheckError ? failure.code : 'UNKNOWN_ERROR';
                setError(code);
                keep = RETRYABLE_ERRORS.includes(code);
            }
        } finally {
            inFlight.current = false;
            // 결과·사진 오류·경로 오류·인증 오류, 화면 이탈·계정 전환 뒤에는 사진과 임시 파일을 정리해요.
            if (!keep) clean();
            if (mounted()) { setBusy(null); if (!keep) setPhoto(null); }
        }
    };

    const stage: ServerStage = !validRoute ? 'route' : busy === 'analyze' ? 'analyzing' : busy === 'pick' ? 'picking'
        : data ? 'result' : error ? 'error' : photo ? 'photo' : 'idle';
    const locked = busy !== null;
    const pickButtons = (primary: boolean) => {
        const capture = primary && (stage === 'idle' || stage === 'picking');
        return (
            <View style={[styles.buttonRow, capture && styles.captureActions]}>
                {capture && <View style={styles.captureSide} />}
                <View style={capture ? styles.captureCenter : styles.flex}>
                    <ServerButton icon="camera" label="표지판 촬영" shutter={capture} variant={primary ? 'fill' : 'outline'} disabled={locked} onPress={() => { void pick(true); }} />
                </View>
                <View style={capture ? styles.captureSide : styles.flex}>
                    <ServerButton icon="image-outline" label="갤러리 선택" captureGallery={capture} variant="outline" disabled={locked} onPress={() => { void pick(false); }} />
                </View>
            </View>
        );
    };
    const guideText = stage === 'route' ? '경로를 먼저 선택해 주세요'
        : stage === 'analyzing' ? '표지판을 읽는 중…'
            : stage === 'picking' ? '사진을 준비하고 있어요'
                : stage === 'result' && data ? RESULT_LOOK[data.result].title
                    : photo ? '선택한 사진이에요' : '표지판 전체가 보이게 맞춰 주세요';

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 헤더 (mock 화면과 같은 모양) */}
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable style={styles.headerButton} onPress={goBack} accessibilityRole="button" accessibilityLabel="닫기">
                    <Ionicons name="close" size={24} color={PURPLE} />
                </Pressable>
                <Text style={styles.headerTitle}>표지판 확인</Text>
                <View style={styles.headerButton} />
            </View>

            {/* 작은 화면·큰 글꼴에서도 잘리지 않게 화면 전체를 스크롤해요. */}
            <ScrollView style={styles.flex} contentContainerStyle={styles.serverScroll} bounces={false}>
                {validRoute && (
                    <View style={styles.routeChip}>
                        <Text style={styles.routeChipLabel}>찾는 방향</Text>
                        <Text style={styles.routeChipText}>{routeSummary}</Text>
                    </View>
                )}

                {/* 사진 영역 */}
                <View style={styles.serverCamera}>
                    <View style={styles.frame}>
                        {photo ? (
                            <Image source={{ uri: photo.uri }} style={styles.serverPhoto} resizeMode="contain" accessibilityLabel="선택한 표지판 사진" />
                        ) : stage === 'result' && data ? (
                            <Ionicons name={RESULT_LOOK[data.result].icon} size={58} color={RESULT_LOOK[data.result].color} />
                        ) : (
                            <Ionicons name={stage === 'route' ? 'map-outline' : 'scan-outline'} size={54} color="rgba(92,63,120,0.3)" />
                        )}
                        <Corner position="topLeft" />
                        <Corner position="topRight" />
                        <Corner position="bottomLeft" />
                        <Corner position="bottomRight" />
                        {stage === 'analyzing' && <ScanLine />}
                    </View>
                    <View style={[styles.guide, styles.serverGuide]}>
                        <Ionicons name="scan-circle-outline" size={16} color={PURPLE} />
                        <Text style={[styles.guideText, styles.shrink]}>{guideText}</Text>
                    </View>
                </View>

                {/* 아래 패널 */}
                <View style={[styles.serverPanel, (stage === 'idle' || stage === 'picking' || stage === 'analyzing') && styles.capturePanel, { paddingBottom: insets.bottom + 24 }]}>
                    {stage === 'route' && (
                        <>
                            <StatusTitle icon="map-outline" color={INK} title="확인할 경로가 없어요" wrap />
                            <Text style={styles.panelText}>{routeIssue ?? '방향을 확인할 경로를 먼저 선택해 주세요.'}</Text>
                            <View style={styles.buttonRow}>
                                <ServerButton icon="search" label="경로 검색" onPress={() => router.replace('/route-search')} />
                            </View>
                        </>
                    )}

                    {stage === 'idle' && (
                        <>
                            <Text style={[styles.panelTitle, styles.captureTitle]}>표지판을 찍어 주세요</Text>
                            <Text style={[styles.panelText, styles.captureText]}>
                                {!route.headsign && !!route.direction
                                    ? `※ 역 이름 / 호선 / ${DIRECTION_LABELS[route.direction]} 표시가 필요해요.`
                                    : '※ 역 이름 / 호선 / 방면이 보이게 찍어 주세요.'}
                            </Text>
                            {pickButtons(true)}
                            <PrivacyNote />
                        </>
                    )}

                    {(stage === 'picking' || stage === 'analyzing') && (
                        <View style={styles.analyzing} accessibilityLiveRegion="polite">
                            <ActivityIndicator color={PURPLE} />
                            <Text style={[styles.panelTitle, styles.captureTitle, styles.center]}>
                                {stage === 'analyzing' ? '표지판을 읽는 중…' : '사진을 준비하고 있어요'}
                            </Text>
                            <Text style={[styles.panelText, styles.captureText, styles.center]}>
                                {stage === 'analyzing'
                                    ? '역 이름 / 노선 / 방면을 내 경로와 비교하는 중이에요. 최대 30초 걸릴 수 있어요.'
                                    : '분석하기 좋은 크기로 사진을 줄이고 있어요. 잠시 기다려 주세요.'}
                            </Text>
                        </View>
                    )}
                    {stage === 'analyzing' && (
                        <View style={styles.buttonRow}>
                            <ServerButton icon="sparkles" label="AI로 확인하기" tone="ai" disabled onPress={() => { void analyze(); }} />
                        </View>
                    )}
                    {stage === 'picking' && pickButtons(true)}

                    {stage === 'photo' && (
                        <>
                            <Text style={styles.panelTitle}>이 사진으로 확인할까요?</Text>
                            <Text style={styles.panelText}>사진은 저장하지 않아요.</Text>
                            <View style={styles.buttonRow}>
                                <ServerButton icon="sparkles" label="AI로 확인하기" tone="ai" disabled={locked} onPress={() => { void analyze(); }} />
                            </View>
                            <Text style={styles.serverHint}>다른 사진으로 바꾸려면</Text>
                            {pickButtons(false)}
                        </>
                    )}

                    {stage === 'result' && data && (
                        <>
                            <ServerResult data={data} direction={route.direction} />
                            <View style={styles.buttonRow}>
                                <ServerButton icon="camera" label="표지판 촬영" displayLabel="다시 촬영" variant="outline" disabled={locked} onPress={() => { void pick(true); }} />
                                <ServerButton icon="map-outline" label="경로 안내로 돌아가기" displayLabel="안내로 돌아가기" disabled={locked} onPress={goBack} />
                            </View>
                            <View style={styles.galleryRow}>
                                <ServerButton icon="image-outline" label="갤러리 선택" variant="outline" disabled={locked} onPress={() => { void pick(false); }} />
                            </View>
                        </>
                    )}

                    {stage === 'error' && error && (
                        <>
                            <StatusTitle {...errorLook(error)} wrap />
                            <Text style={styles.message} accessibilityRole="alert">{SERVER_ERROR_TEXT[error]}</Text>
                            {RETRYABLE_ERRORS.includes(error) && (photo ? (
                                <>
                                    <View style={styles.buttonRow}>
                                        <ServerButton icon="refresh" label="다시 시도" tone="ai" disabled={locked} onPress={() => { void analyze(); }} />
                                    </View>
                                    <Text style={styles.serverHint}>같은 사진으로 다시 확인해요. 다른 사진을 골라도 돼요.</Text>
                                    {pickButtons(false)}
                                </>
                            ) : pickButtons(true))}
                            {error === 'IMAGE_INVALID' && (
                                <>
                                    <Text style={styles.serverHint}>표지판이 잘 보이는 다른 사진을 골라 주세요.</Text>
                                    {pickButtons(true)}
                                </>
                            )}
                            {ROUTE_ERRORS.includes(error) && (
                                <View style={styles.buttonRow}>
                                    <ServerButton icon="map-outline" label="경로 다시 선택" disabled={locked} onPress={() => router.replace('/route-search')} />
                                </View>
                            )}
                        </>
                    )}
                </View>
            </ScrollView>
        </View>
    );
}

/** 서버 결과: 결과 3종을 제목·색·아이콘으로 구분하고, 읽은 값과 내 경로 값을 나란히 보여줘요. */
function ServerResult({ data, direction }: { data: DirectionCheckResponse; direction?: DirectionCode }) {
    const look = RESULT_LOOK[data.result];
    const directionOnly = data.expected.headsign === null && direction !== undefined;
    const tips = directionOnly && data.reason === 'MISSING_INFO'
        ? ['상행 / 하행 / 내선 / 외선 / 응암순환 표시가 보이게', '행선지 이름만으로는 방향을 확정할 수 없어요', '판단이 어려우면 역 안내 표지와 경로를 함께 확인해 주세요']
        : ['표지판 전체가 네모 안에 들어오게', '글자가 흐리지 않게 가까이에서', '빛 반사가 없는 각도로'];
    return (
        <View accessibilityLiveRegion="polite">
            <ResultHeading icon={look.icon} color={look.color} title={look.title} message={data.message} />
            <SignComparison data={data} direction={direction} />

            {data.result === 'RETAKE' && (
                <View style={styles.tips}>
                    {tips.map(tip => (
                        <View key={tip} style={styles.tipRow}>
                            <Ionicons name="checkmark" size={15} color={PURPLE} />
                            <Text style={[styles.tipText, styles.shrink]}>{tip}</Text>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}

/** 두 행 표 안에서도 역·노선·방향의 인식 여부와 서버 판정 차이를 보존해요. */
function SignComparison({ data, direction }: { data: DirectionCheckResponse; direction?: DirectionCode }) {
    const directionOnly = data.expected.headsign === null && direction !== undefined;
    return (
        <View style={styles.grid}>
            {(['recognized', 'expected'] as const).map((side, row) => (
                <View key={side} style={[styles.comparisonRow, row === 0 && styles.comparisonDivider]}>
                    <Text style={styles.comparisonLabel}>{row === 0 ? '인식한 문구' : '가야 할 방향'}</Text>
                    <View style={styles.comparisonValues}>
                        {COMPARE_FIELDS.map(({ key, label }) => {
                            const read = data.recognized[key];
                            const want = data.expected[key];
                            const codeOnly = key === 'headsign' && directionOnly;
                            const raw = row === 0 ? read : codeOnly ? DIRECTION_LABELS[direction!] : want;
                            const value = key === 'stationName' && raw ? formatStationName(raw) : raw;
                            const differs = read != null && want != null && !sameSign(read, want);
                            const bad = row === 0 && data.result === 'WRONG' && (codeOnly ? data.reason === 'DIRECTION_MISMATCH' && read != null : differs);
                            const good = row === 0 && data.result === 'CORRECT' && read != null && !differs;
                            const a11yLabel = codeOnly ? (row === 0 ? '읽은 방향 표시' : '내 경로 방향') : `${row === 0 ? '읽은' : '내 경로'} ${label}`;
                            return (
                                <Text key={key} accessibilityLabel={a11yLabel} style={[styles.comparisonValue, good && { color: PURPLE }, bad && { color: WARNING }, value == null && styles.cellMuted]}>
                                    {codeOnly && <Text style={styles.directionLabel}>{a11yLabel}: </Text>}
                                    {value ?? (row === 0 ? '읽지 못했어요' : '정보 없음')}
                                </Text>
                            );
                        })}
                    </View>
                </View>
            ))}
        </View>
    );
}

function ResultHeading({ icon, color, title, message }: { icon: IconName; color: string; title: string; message: string }) {
    return (
        <View style={styles.resultHeading}>
            <View style={styles.passenger}><Passenger tone="me" size={50} /></View>
            <View style={styles.resultCopy}>
                <View style={styles.statusRow}>
                    <Text accessibilityRole="header" style={[styles.statusTitle, { color }, styles.shrink]}>{title}</Text>
                    <Ionicons name={icon} size={18} color={color} />
                </View>
                <Text style={styles.message}>{message}</Text>
            </View>
        </View>
    );
}

function PrivacyNote() {
    return (
        <View style={styles.serverNote}>
            <Ionicons name="shield-checkmark-outline" size={16} color={PURPLE} />
            <Text style={styles.serverNoteText}>사진은 저장하지 않아요.</Text>
        </View>
    );
}

function ServerButton({ icon, label, displayLabel, shutter, captureGallery, onPress, disabled = false, variant, tone }: {
    icon: IconName;
    label: string;
    displayLabel?: string;
    shutter?: boolean;
    captureGallery?: boolean;
    onPress: () => void;
    disabled?: boolean;
    variant?: 'fill' | 'outline';
    tone?: 'navy' | 'ai';
}) {
    return <ActionButton icon={icon} label={displayLabel ?? label} onPress={onPress} variant={variant} tone={tone} disabled={disabled} shutter={shutter} captureGallery={captureGallery} fluid />;
}

function MockDirectionScreen() {
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
            <StatusBar style="dark" />

            {/* 헤더 */}
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable style={styles.headerButton} onPress={goBack} accessibilityLabel="닫기">
                    <Ionicons name="close" size={24} color={PURPLE} />
                </Pressable>
                <Text style={styles.headerTitle}>표지판 확인</Text>
                <View style={styles.headerButton} />
            </View>

            <ScrollView style={styles.flex} contentContainerStyle={styles.serverScroll} bounces={false}>
                {/* 내 경로 (명세 9.1 route 파트) */}
                <View style={styles.routeChip}>
                    <Text style={styles.routeChipLabel}>{fromRoute ? '찾는 방향' : '예시 경로'}</Text>
                    <Text style={styles.routeChipText}>
                        {formatStationName(expected.stationName)} / {expected.lineName} {expected.headsign}
                    </Text>
                </View>

                {/* 카메라 영역 (지금은 예시 사진) */}
                <View style={styles.serverCamera}>
                    <View style={styles.frame}>
                        <Corner position="topLeft" />
                        <Corner position="topRight" />
                        <Corner position="bottomLeft" />
                        <Corner position="bottomRight" />

                        {shownSign ? <SignPlate sign={shownSign} /> : <Ionicons name="scan-outline" size={54} color="rgba(255,255,255,0.35)" />}
                        {phase.kind === 'analyzing' && <ScanLine />}
                    </View>

                    <View style={[styles.guide, styles.serverGuide]}>
                        <Ionicons name="scan-circle-outline" size={16} color={PURPLE} />
                        <Text style={styles.guideText}>
                            {phase.kind === 'analyzing'
                                ? '표지판을 읽는 중…'
                                : '표지판 전체가 보이게 맞춰 주세요'}
                        </Text>
                    </View>
                </View>

                {/* 아래 패널 */}
                <View style={[styles.serverPanel, (phase.kind === 'waiting' || phase.kind === 'analyzing') && styles.capturePanel, { paddingBottom: insets.bottom + 24 }]}>
                        {phase.kind === 'waiting' && (
                            <>
                                <Text style={[styles.panelTitle, styles.captureTitle]}>표지판을 찍어 주세요</Text>
                                <Text style={[styles.panelText, styles.captureText]}>※ 역 이름 / 호선 / 방면이 보이게 찍어 주세요.</Text>
                                <View style={[styles.buttonRow, styles.captureActions]}>
                                    <View style={styles.captureSide} />
                                    <View style={styles.captureCenter}>
                                        <ActionButton icon="camera" label="표지판 촬영" shutter onPress={() => setPickerOpen(true)} />
                                    </View>
                                    <View style={styles.captureSide}>
                                        <ActionButton icon="image-outline" label="사진 업로드" captureGallery variant="outline" onPress={() => setPickerOpen(true)} />
                                    </View>
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
                                        <Text style={styles.sampleTagText}>예시 / {phase.sample.title}</Text>
                                    </View>
                                </View>
                                <Text style={styles.panelText}>사진은 저장하지 않아요.</Text>
                                <View style={styles.buttonRow}>
                                    <ActionButton icon="sparkles" label="AI로 확인하기" tone="ai" onPress={() => analyze(phase.sample)} />
                                    <ActionButton icon="refresh" label="다시 선택" variant="outline" onPress={restart} />
                                </View>
                            </>
                        )}

                        {phase.kind === 'analyzing' && (
                            <View style={styles.analyzing}>
                                <ActivityIndicator color={PURPLE} />
                                <Text style={[styles.panelTitle, styles.captureTitle]}>표지판을 읽는 중…</Text>
                                <Text style={[styles.panelText, styles.captureText]}>역 이름 / 노선 / 방면을 내 경로와 비교하는 중이에요.</Text>
                            </View>
                        )}

                        {phase.kind === 'result' && (
                            <ResultPanel
                                data={phase.data}
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
                </View>
            </ScrollView>

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
                            실제 촬영 / 앨범 대신 예시 사진으로 결과 화면을 확인해요.
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
                         ride,
                         fromRoute,
                         onRetake,
                         onBack,
                     }: {
    data: DirectionCheckResponse;
    ride: { stops: number; minutes: number; alightName: string } | null;
    fromRoute: boolean;
    onRetake: () => void;
    onBack: () => void;
}) {
    const backLabel = fromRoute ? '안내로 돌아가기' : '닫기';

    if (data.result === 'RETAKE') {
        const title =
            data.reason === 'NOT_A_SIGN'
                ? '표지판이 아닌 것 같아요'
                : data.reason === 'MISSING_INFO'
                    ? '방면 정보가 보이지 않아요'
                    : '표지판을 읽기 어려워요';
        return (
            <View>
                <ResultHeading icon="camera-reverse-outline" color={RETAKE_COLOR} title={title} message={data.message} />
                <View style={styles.tips}>
                    {['표지판 전체가 네모 안에 들어오게', '글자가 흐리지 않게 가까이에서', '빛 반사가 없는 각도로'].map(tip => (
                        <View key={tip} style={styles.tipRow}>
                            <Ionicons name="checkmark" size={15} color={PURPLE} />
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
    const title = correct ? '맞는 방향이에요' : wrongLine ? '경로에 없는 노선이에요' : '반대 방향이에요';

    return (
        <View>
            <ResultHeading icon={correct ? 'checkmark-circle' : 'close-circle'} color={correct ? PURPLE : WARNING} title={title} message={data.message} />
            <SignComparison data={data} />

            {correct && ride && (
                <Text style={styles.panelText}>
                    {ride.stops}개역 / {ride.minutes}분 후 {formatStationName(ride.alightName)}에서 하차
                </Text>
            )}
            <View style={styles.buttonRow}>
                <ActionButton icon="camera" label="다시 촬영" variant="outline" onPress={onRetake} />
                <ActionButton icon="map-outline" label={backLabel} onPress={onBack} />
            </View>
        </View>
    );
}

/* ---------- 작은 부품 ---------- */

/** wrap: 서버 화면에서 큰 글꼴일 때 제목이 줄바꿈되게 해요 (mock 화면은 쓰지 않아요). */
function StatusTitle({ icon, color, title, wrap }: { icon: IconName; color: string; title: string; wrap?: boolean }) {
    return (
        <View style={styles.resultHeading}>
            <View style={styles.passenger}><Passenger tone="me" size={50} /></View>
            <View style={[styles.statusRow, styles.resultCopy]}>
                <Text accessibilityRole="header" style={[styles.statusTitle, { color }, wrap && styles.shrink]}>{title}</Text>
                <Ionicons name={icon} size={18} color={color} />
            </View>
        </View>
    );
}

function ActionButton({
                          icon,
                          label,
                          onPress,
                          variant = 'fill',
                          disabled,
                          fluid,
                          shutter = false,
                          captureGallery = false,
                      }: {
    icon: IconName;
    label: string;
    onPress: () => void;
    variant?: 'fill' | 'outline';
    tone?: 'navy' | 'ai';
    /** 촬영 대기 화면의 갤러리 아이콘 모양만 지정해요. */
    captureGallery?: boolean;
    /** 촬영 대기 화면의 원형 버튼 모양만 지정해요. */
    shutter?: boolean;
    /** 서버 화면 전용: 처리 중 버튼 잠금 */
    disabled?: boolean;
    /** 서버 화면 전용: 큰 글꼴에서 높이가 늘어나고 글자가 줄바꿈돼요. */
    fluid?: boolean;
}) {
    const fill = variant === 'fill';
    const color = PURPLE;
    return (
        <Pressable
            accessibilityLabel={label}
            style={({ pressed }) => [
                styles.action,
                fill ? { backgroundColor: color } : { borderWidth: 1, borderColor: '#E8E4ED', backgroundColor: WHITE },
                pressed && styles.pressed,
                fluid && styles.actionFluid,
                shutter && styles.shutterAction,
                captureGallery && styles.captureGalleryAction,
                disabled && styles.disabled,
            ]}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={disabled ? { disabled: true } : undefined}
        >
            {shutter ? (
                <>
                    <View style={styles.captureIconSlot}><View style={styles.shutterRing}><View style={styles.shutterInner} /></View></View>
                    <Text style={styles.captureGalleryLabel}>촬영</Text>
                </>
            ) : captureGallery ? (
                <>
                    <View style={styles.captureIconSlot}><View style={styles.captureGalleryIcon}><Ionicons name={icon} size={24} color={PURPLE} /></View></View>
                    <Text style={styles.captureGalleryLabel}>갤러리</Text>
                </>
            ) : (
                <>
                    <Ionicons name={icon} size={18} color={fill ? WHITE : INK} />
                    <Text style={[styles.actionText, { color: fill ? WHITE : INK }, fluid && styles.actionTextFluid]}>{label}</Text>
                </>
            )}
        </Pressable>
    );
}

function MockNotice() {
    return (
        <View style={styles.notice}>
            <Ionicons name="flask-outline" size={16} color="#7a5600" />
            <Text style={styles.noticeText}>
                테스트 버전이에요. 실제 카메라 / 앨범 대신 예시 사진으로 확인하고, 사진은 저장하지 않아요.
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
    captureActions: { justifyContent: 'center', alignItems: 'flex-start', gap: 12, marginTop: 24 },
    captureSide: { width: 72, alignItems: 'center' },
    captureCenter: { flex: 1, alignItems: 'center' },
    capturePanel: { backgroundColor: CAMERA_BG, paddingTop: 0 },
    captureTitle: { color: INK, textAlign: 'center', fontSize: 18 },
    captureText: { color: '#6E6A77', textAlign: 'center', fontSize: 13, lineHeight: 20 },
    resultHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
    passenger: { width: 50, flexShrink: 0, paddingTop: 2 },
    resultCopy: { flex: 1 },
    comparisonRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 11, gap: 10 },
    comparisonDivider: { borderBottomWidth: 1, borderBottomColor: BORDER },
    comparisonLabel: { color: SECONDARY, fontSize: 13.5, lineHeight: 21, flexShrink: 1 },
    comparisonValues: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4 },
    comparisonValue: { color: INK, fontSize: 13.5, fontWeight: '600', lineHeight: 21, flexShrink: 1, textAlign: 'right' },
    directionLabel: { color: SECONDARY, fontSize: 12, fontWeight: '400' },
    captureGalleryAction: { flex: 0, minHeight: 104, padding: 4, flexDirection: 'column', gap: 6, borderWidth: 0, backgroundColor: 'transparent' },
    captureGalleryIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: WHITE, borderWidth: 1, borderColor: '#DED8E6', alignItems: 'center', justifyContent: 'center' },
    captureGalleryLabel: { color: '#6E6A77', fontSize: 12, lineHeight: 17, fontWeight: '500' },
    galleryRow: { alignSelf: 'center', marginTop: 8 },
    shutterAction: { flex: 0, minHeight: 104, padding: 4, flexDirection: 'column', gap: 6, backgroundColor: 'transparent' },
    captureIconSlot: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
    shutterRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: PURPLE, padding: 4 },
    shutterInner: { flex: 1, borderRadius: 32, backgroundColor: '#EDE8F3' },

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
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },

    headerTitle: {
        color: INK,
        fontSize: 15,
        fontWeight: '600',
    },

    routeChip: {
        marginHorizontal: 20,
        paddingTop: 6,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },

    routeChipLabel: {
        color: '#6E6A77',
        fontSize: 13,
        fontWeight: '400',
    },

    routeChipText: {
        flexShrink: 1,
        color: '#6E6A77',
        fontSize: 13,
        lineHeight: 20,
        textAlign: 'center',
    },

    cameraArea: {
        flex: 1,
        minHeight: 220,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
    },

    frame: {
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },

    corner: {
        position: 'absolute',
        width: 28,
        height: 28,
        borderColor: PURPLE,
    },

    topLeft: { top: 28, left: 28, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
    topRight: { top: 28, right: 28, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
    bottomLeft: { bottom: 28, left: 28, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
    bottomRight: { bottom: 28, right: 28, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },

    scanLine: {
        position: 'absolute',
        left: 24,
        right: 24,
        height: 3,
        borderRadius: 2,
        backgroundColor: LAVENDER,
        boxShadow: '0px 0px 18px 4px rgba(184,155,199,0.6)',
    },

    guide: {
        position: 'absolute',
        bottom: 44,
        left: 20,
        right: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },

    guideText: {
        color: PURPLE,
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
        fontWeight: '800',
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
        fontWeight: '800',
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
        color: INK,
        fontSize: 18,
        fontWeight: '700',
    },

    panelText: {
        marginTop: 6,
        color: SECONDARY,
        fontSize: 13.5,
        fontWeight: '500',
        lineHeight: 19,
    },

    buttonRow: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    action: {
        flex: 1,
        minHeight: 50,
        paddingHorizontal: 8,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderRadius: 14,
    },

    actionText: {
        flexShrink: 1,
        textAlign: 'center',
        fontSize: 15,
        fontWeight: '600',
    },

    notice: {
        marginTop: 14,
        padding: 11,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 7,
        borderRadius: 11,
        backgroundColor: '#EDE8F3',
    },

    noticeText: {
        flex: 1,
        color: PURPLE,
        fontSize: 12.5,
        fontWeight: '600',
        lineHeight: 17,
    },

    sampleTag: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 7,
        backgroundColor: '#EDE8F3',
    },

    sampleTagText: {
        color: PURPLE,
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
        fontSize: 21,
        fontWeight: '800',
        lineHeight: 28,
    },

    aiChip: {
        paddingHorizontal: 7,
        paddingVertical: 3,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        borderRadius: 7,
        backgroundColor: '#EDE8F3',
    },

    aiChipText: {
        color: AI,
        fontSize: 11,
        fontWeight: '800',
    },

    message: {
        marginTop: 4,
        color: INK,
        fontSize: 14.5,
        fontWeight: '400',
        lineHeight: 21,
    },

    grid: {
        marginTop: 16,
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
        color: INK,
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
        backgroundColor: '#EDE8F3',
    },

    guideCardBad: {
        backgroundColor: '#EDE8F3',
    },

    guideIcon: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
    },

    guideTitle: {
        color: INK,
        fontSize: 15,
        fontWeight: '800',
    },

    guideSub: {
        marginTop: 3,
        color: '#6E6A77',
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
        color: '#6E6A77',
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
        color: INK,
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
        backgroundColor: '#DED8E6',
    },

    testTag: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 7,
        backgroundColor: '#EDE8F3',
    },

    testTagText: {
        color: PURPLE,
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
        color: INK,
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

    /* ---------- 서버 모드 화면 전용 (#125) ---------- */

    shrink: {
        flexShrink: 1,
    },

    center: {
        textAlign: 'center',
    },

    wrapRow: {
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: 6,
    },

    disabled: {
        opacity: 0.5,
    },

    actionFluid: {
        height: 'auto',
        minHeight: 50,
        paddingVertical: 12,
        paddingHorizontal: 10,
    },

    actionTextFluid: {
        flexShrink: 1,
        textAlign: 'center',
    },

    cellMuted: {
        color: SECONDARY,
        fontWeight: '600',
    },

    serverScroll: {
        flexGrow: 1,
        paddingTop: 8,
    },

    serverCamera: {
        marginHorizontal: 20,
        marginTop: 20,
        marginBottom: 24,
        height: 400,
        borderRadius: 24,
        overflow: 'hidden',
        backgroundColor: '#EDE8F3',
        alignItems: 'center',
        justifyContent: 'center',
    },

    serverPhoto: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    },

    serverGuide: {
        padding: 8,
        borderRadius: 10,
        backgroundColor: 'rgba(255,255,255,0.9)',
    },

    serverPanel: {
        flexGrow: 1,
        paddingHorizontal: 20,
        paddingTop: 22,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        backgroundColor: WHITE,
    },

    serverHint: {
        marginTop: 16,
        color: SECONDARY,
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 18,
    },

    serverMessage: {
        marginTop: 0,
    },

    guideCardRetake: {
        backgroundColor: '#EDE8F3',
    },

    serverNote: {
        marginTop: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },

    serverNoteText: {
        flexShrink: 1,
        color: '#6E6A77',
        fontSize: 12,
        fontWeight: '600',
        lineHeight: 18,
    },
});
