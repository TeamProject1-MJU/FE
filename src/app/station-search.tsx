import { formatStationName } from '@/utils/station-name';
/**
 * 역 검색·선택 화면 (이슈 #33)
 *
 * 검색은 services/station.ts 를 거친다. mock 모드에서만 mocks/stations.ts 의
 * 대안역·검색어 제안을 쓰고, 서버 모드에서는 서버 역만 보여주고 돌려준다.
 * 다른 화면에서는 아래처럼 쓴다:
 *
 *   import { openStationPicker, type Station } from '@/app/station-search';
 *   openStationPicker({ purpose: 'origin' }, (station) => setOrigin(station));
 *
 * 구성 (위에서부터)
 *   1. 타입 재공개·mock 대안역 계산
 *   2. 호출 헬퍼 (openStationPicker) + 최근 검색
 *   3. LineBadge 컴포넌트
 *   4. 화면 (default export)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    View,
} from 'react-native';
import { Text, TextInput } from '@/components/app-text';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { searchStations as fetchStationSearch, STATION_KEYWORD_MAX_LENGTH } from '@/services/station';
import { useMock as isMockMode } from '@/services/api/config';
import { MOCK_STATIONS, searchStations } from '@/mocks/stations';
import { ApiError, isAuthError } from '@/services/api/errors';
import type { Station, StationLine } from '@/types/station';

export type { Station, StationLine } from '@/types/station';

/* ═══════════════ 1. 타입 · mock 대안역 ═══════════════ */

const SEARCH_DEBOUNCE_MS = 300;

/** 두 좌표 사이 거리(m) — 가까운 지원 역 제안용 */
function distanceMeters(a: Station, b: Station): number {
    const r = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(h));
}

export type NearbyStation = { station: Station; walkMinutes: number };

/** 미제공 역 근처의 지원 역 (도보 분 = 거리 / 67m·분) */
export function findNearbySupported(origin: Station, count = 2): NearbyStation[] {
    if (!isMockMode()) return [];
    return MOCK_STATIONS
        .filter((station) => station.isSupported && station.id !== origin.id)
        .map((station) => ({ station, meters: distanceMeters(origin, station) }))
        .sort((a, b) => a.meters - b.meters)
        .slice(0, count)
        .map(({ station, meters }) => ({ station, walkMinutes: Math.max(1, Math.round(meters / 67)) }));
}

/** 검색 실패 종류. 화면 문구와 '다시 시도' 버튼 표시를 정해요. */
export type SearchFailure = {
    kind: 'auth' | 'network' | 'invalid' | 'server';
    title: string;
    description: string;
    retry: boolean;
};

/**
 * 401 은 안내만 해요. 토큰 갱신·로그인 이동은 A-1(로그인) 범위예요.
 * 4xx 는 다시 시도해도 같으므로 버튼을 두지 않고, 네트워크·5xx 만 다시 시도할 수 있어요.
 */
export function describeSearchError(error: unknown): SearchFailure {
    if (isAuthError(error)) {
        return { kind: 'auth', title: '로그인이 필요해요', description: '로그인한 뒤에 역을 검색할 수 있어요.', retry: false };
    }
    if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
        return { kind: 'network', title: '서버에 연결하지 못했어요', description: '인터넷 연결을 확인하고 다시 시도해 주세요.', retry: true };
    }
    if (error instanceof ApiError && error.status !== null && error.status >= 400 && error.status < 500) {
        return { kind: 'invalid', title: '검색어를 확인해 주세요', description: error.message, retry: false };
    }
    return { kind: 'server', title: '역 정보를 불러오지 못했어요', description: '잠시 후 다시 시도해 주세요.', retry: true };
}

/* ═══════════════ 2. 호출 헬퍼 · 최근 검색 ═══════════════ */

/**
 * 역 검색·선택 화면(/station-search)과 호출 화면을 잇는 헬퍼.
 *
 * 호출 화면은 전역 스토어 없이 콜백으로 결과를 받는다.
 *
 *   openStationPicker(
 *       { purpose: 'origin' },
 *       (station) => setOrigin(station),
 *   );
 *
 * 선택 화면은 사용자가 역을 고르면 `resolveStationPicker(station)`을 호출하고
 * 뒤로 간다. 선택 없이 뒤로 가면 콜백은 호출되지 않는다.
 */

/**
 * 어디서 역을 고르는지.
 * - origin / destination : 혼자 이동 경로 검색(6.1)의 출발·도착역
 * - departure            : 약속방 내 내 출발역(7.7)
 * - proposal             : 약속방 약속역 후보 직접 제안(7.14, #50)
 *
 * 네 경우 모두 서버가 isSupported=true만 받는다(STATION_UNSUPPORTED 422).
 * 따라서 선택 규칙은 동일하고, purpose는 화면 문구에만 쓰인다.
 */
export type StationPickerPurpose =
    | 'origin'
    | 'destination'
    | 'departure'
    | 'proposal'
    | 'selected-station';

export type StationPickerOptions = {
    purpose: StationPickerPurpose;
    /** 약속방 이름 등, 제목 문구에 붙일 맥락 (departure·proposal에서 사용) */
    contextLabel?: string;
    /** 이미 선택돼 있는 역 — 목록에서 체크 표시 */
    selectedStationId?: number;
};

type Pending = {
    options: StationPickerOptions;
    onSelect: (station: Station) => void;
};

let pending: Pending | null = null;

export function openStationPicker(
    options: StationPickerOptions,
    onSelect: (station: Station) => void,
) {
    pending = { options, onSelect };
    router.push({
        pathname: '/station-search',
        params: {
            purpose: options.purpose,
            contextLabel: options.contextLabel ?? '',
            selectedStationId: options.selectedStationId != null ? String(options.selectedStationId) : '',
        },
    });
}

/** 선택 화면이 호출. 콜백 실행 후 대기 상태를 비운다. */
export function resolveStationPicker(station: Station) {
    const current = pending;
    pending = null;
    current?.onSelect(station);
}

/** 선택 없이 닫힐 때 호출 (뒤로가기) */
export function cancelStationPicker() {
    pending = null;
}

/** 화면 문구 */
export function pickerCopy(purpose: StationPickerPurpose, contextLabel?: string) {
    switch (purpose) {
        case 'origin':
            return { chip: '혼자 이동 · 출발역', title: '어느 역에서\n출발하시나요?' };
        case 'destination':
            return { chip: '혼자 이동 · 도착역', title: '어느 역으로\n가시나요?' };
        case 'departure':
            return {
                chip: '약속방 · 내 출발역',
                title: contextLabel ? `${contextLabel},\n어디서 출발하세요?` : '어디서\n출발하세요?',
            };
        case 'proposal':
            return {
                chip: '약속방 · 약속역 후보 제안',
                title: '어느 역에서\n만나면 좋을까요?',
            };
        case 'selected-station':
            return {
                chip: '약속방 · 최종 약속역',
                title: '어느 역에서\n만날까요?',
            };
    }
}

/* ───────── 최근 검색 (세션 메모리, 앱 재시작 시 초기화) ───────── */

const RECENT_LIMIT = 5;
let recent: Station[] = [];

export function getRecentStations(): Station[] {
    return recent;
}

export function pushRecentStation(station: Station) {
    recent = [station, ...recent.filter((item) => item.id !== station.id)].slice(0, RECENT_LIMIT);
}

export function clearRecentStations() {
    recent = [];
}

/* ═══════════════ 3. 노선 배지 ═══════════════ */

type Props = {
    line: StationLine;
    /** 기본 24. 작은 곳은 18~20 */
    size?: number;
    /** 흐리게 (미제공 역 등) */
    muted?: boolean;
};

/**
 * 노선 배지. 숫자 호선(1~9)은 원형에 숫자, 그 외(수인분당 등)는 알약형에 노선명.
 * 색은 API lines[].color 값을 그대로 쓴다.
 */
export function LineBadge({ line, size = 24, muted = false }: Props) {
    const short = line.lineName.replace(/호선$/, '');
    const isNumeric = /^\d+$/.test(short);
    const label = isNumeric ? short : line.lineName.replace(/선$/, '');

    return (
        <View
            style={[
                badgeStyles.badge,
                {
                    height: size,
                    minWidth: size,
                    borderRadius: size / 2,
                    paddingHorizontal: isNumeric ? 0 : Math.round(size * 0.38),
                    backgroundColor: muted ? '#d9dde4' : line.color,
                },
            ]}
            accessibilityLabel={line.lineName}
        >
            <Text
                style={[
                    badgeStyles.label,
                    { fontSize: isNumeric ? Math.round(size * 0.5) : Math.round(size * 0.46) },
                ]}
                numberOfLines={1}
            >
                {label}
            </Text>
        </View>
    );
}

const badgeStyles = StyleSheet.create({
    badge: {
        alignItems: 'center',
        justifyContent: 'center',
    },

    label: {
        color: '#ffffff',
        fontWeight: '800',
        fontVariant: ['tabular-nums'],
        includeFontPadding: false,
    },
});

/* ═══════════════ 4. 화면 ═══════════════ */

// 시안(#184 라벤더) 색 — design-ref/template.html "02 경로 검색" 의 역 검색 상태 값이에요.
const LV_BACKGROUND = '#F7F5FA';
const LV_CARD = '#FFFFFF';
const LV_CARD_BORDER = '#EEEAF2';
const LV_TEXT = '#25212D';
const LV_SECONDARY = '#83808B';
const LV_MAIN = '#5C3F78';
const LV_ROW_DIVIDER = '#EFEBF3';
const LV_ROW_ICON = '#B4AFBC';
const LV_BADGE_BACKGROUND = '#F1EEF4';
const LV_SOFT = '#F4F1F7';
const LV_PLACEHOLDER = '#B4AFBC';
const LV_CLEAR = '#C9C3D1';
const LV_PRESSED = '#F1EEF4';
const LV_DIM = 'rgba(37,33,45,0.42)';

type Params = {
    purpose?: StationPickerPurpose;
    contextLabel?: string;
    selectedStationId?: string;
};

export default function StationSearchScreen() {
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<Params>();

    const purpose: StationPickerPurpose = params.purpose ?? 'origin';
    const contextLabel = params.contextLabel || undefined;
    const selectedStationId = params.selectedStationId ? Number(params.selectedStationId) : undefined;
    const copy = pickerCopy(purpose, contextLabel);

    const inputRef = useRef<TextInput>(null);
    const [query, setQuery] = useState('');
    const [focused, setFocused] = useState(true);
    const [recent, setRecent] = useState<Station[]>(() => getRecentStations());
    const [unsupported, setUnsupported] = useState<Station | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [search, setSearch] = useState<{
        keyword: string;
        items: Station[];
        totalElements: number;
        loading: boolean;
        error: SearchFailure | null;
    }>({ keyword: '', items: [], totalElements: 0, loading: false, error: null });

    const trimmed = query.trim();
    const results = search.keyword === trimmed ? search.items : [];
    const searching = search.keyword !== trimmed || search.loading;
    const searchError = search.keyword === trimmed ? search.error : null;
    // 첫 페이지(최대 50개)만 보여주고, 더 있으면 검색어를 좁히도록 안내해요.
    const hiddenCount = search.keyword === trimmed ? Math.max(0, search.totalElements - results.length) : 0;
    const unsupportedCount = results.filter((station) => !station.isSupported).length;
    const nearby: NearbyStation[] = useMemo(
        () => (unsupported ? findNearbySupported(unsupported) : []),
        [unsupported],
    );

    useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus(), 250);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        let active = true;
        setSearch({ keyword: trimmed, items: [], totalElements: 0, loading: !!trimmed, error: null });
        if (!trimmed) return () => { active = false; };

        const timer = setTimeout(() => {
            fetchStationSearch(trimmed).then(result => {
                if (active) setSearch({ keyword: trimmed, items: result.items, totalElements: result.totalElements, loading: false, error: null });
            }).catch(error => {
                if (active) setSearch({ keyword: trimmed, items: [], totalElements: 0, loading: false, error: describeSearchError(error) });
            });
        }, SEARCH_DEBOUNCE_MS);
        // 이전 검색이나 닫힌 화면의 응답이 현재 결과를 덮어쓰지 않도록 합니다.
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [trimmed, retryKey]);

    const goBack = useCallback(() => {
        cancelStationPicker();
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/home');
        }
    }, []);

    const choose = useCallback((station: Station) => {
        if (!station.isSupported) {
            Keyboard.dismiss();
            setUnsupported(station);
            return;
        }
        pushRecentStation(station);
        resolveStationPicker(station);
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/home');
        }
    }, []);

    const chooseNearby = useCallback((station: Station) => {
        if (!isMockMode()) return;
        setUnsupported(null);
        choose(station);
    }, [choose]);

    const retrySearch = useCallback((text: string) => {
        setQuery(text);
        inputRef.current?.focus();
    }, []);

    const handleClearRecent = () => {
        clearRecentStations();
        setRecent([]);
    };

    const showRecent = trimmed.length === 0;
    const data = showRecent ? recent : results;


    const headerTitle = purpose === 'origin' ? '출발역 검색' : purpose === 'destination' ? '도착역 검색' : copy.title;
    const placeholder = purpose === 'origin' ? '출발역' : purpose === 'destination' ? '도착역' : '역 이름을 입력하세요';
    // 출발 쪽은 채운 점, 도착(만날 역) 쪽은 테두리 점
    const filledPoint = purpose === 'origin' || purpose === 'departure';

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            <View style={{ paddingTop: insets.top }}>
                <View style={styles.header}>
                    <Pressable style={styles.backButton} onPress={goBack} accessibilityRole="button" accessibilityLabel="뒤로가기">
                        <Ionicons name="chevron-back" size={24} color="#25212D" />
                    </Pressable>
                    <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">{headerTitle.replace(/\n/g, ' ')}</Text>
                    <Pressable style={styles.cancelButton} onPress={goBack} accessibilityRole="button" accessibilityLabel="취소">
                        <Text style={styles.cancelText}>취소</Text>
                    </Pressable>
                </View>
            </View>

            {/* 검색창은 헤더 다음 줄에 배치해요. */}
            <View style={styles.searchWrap}>
                <Pressable style={styles.search} onPress={() => inputRef.current?.focus()}>
                    <View style={[styles.point, filledPoint ? styles.pointFilled : styles.pointOutline]} />
                    <TextInput
                        ref={inputRef}
                        style={styles.input}
                        value={query}
                        onChangeText={setQuery}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        placeholder={placeholder}
                        placeholderTextColor={LV_PLACEHOLDER}
                        returnKeyType="search"
                        // maxLength 는 UTF-16 기준이라 코드 포인트로 세는 서버보다 엄격해요(이모지는 2글자로 세요).
                        maxLength={STATION_KEYWORD_MAX_LENGTH}
                        autoCorrect={false}
                        autoCapitalize="none"
                        selectionColor={LV_MAIN}
                        accessibilityLabel="역 이름 검색"
                    />
                    {query.length > 0 && (
                        <Pressable
                            style={styles.clearButton}
                            onPress={() => setQuery('')}
                            accessibilityRole="button"
                            accessibilityLabel="검색어 지우기"
                            hitSlop={8}
                        >
                            <Ionicons name="close" size={13} color={LV_CARD} />
                        </Pressable>
                    )}
                </Pressable>
            </View>

            {/* 목록 (키보드 위까지만 차지) */}
            <KeyboardAvoidingView
                style={styles.listArea}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                {!showRecent && (searching || searchError) ? (
                    <View style={styles.status} accessibilityLiveRegion="polite">
                        {searchError && <Text style={styles.statusTitle}>{searchError.title}</Text>}
                        <Text style={styles.statusText}>{searchError ? searchError.description : '역을 검색하고 있어요'}</Text>
                        {searchError?.retry && (
                            <Pressable style={styles.suggestChip} onPress={() => setRetryKey(value => value + 1)} accessibilityRole="button">
                                <Text style={styles.suggestText}>다시 시도</Text>
                            </Pressable>
                        )}
                    </View>
                ) : !showRecent && results.length === 0 ? (
                    <NoResults keyword={trimmed} onRetry={retrySearch} />
                ) : (
                    <FlatList
                        data={data}
                        keyExtractor={(item) => String(item.id)}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode="on-drag"
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
                        ListHeaderComponent={
                            showRecent && recent.length > 0 ? (
                                <View style={styles.sectionRow}>
                                    <Text style={styles.sectionTitle}>최근 검색</Text>
                                    <Pressable style={styles.sectionAction} onPress={handleClearRecent} hitSlop={8}>
                                        <Text style={styles.sectionActionText}>전체 지우기</Text>
                                    </Pressable>
                                </View>
                            ) : null
                        }
                        ListEmptyComponent={
                            showRecent ? <RecentEmpty /> : null
                        }
                        ListFooterComponent={
                            showRecent ? <SupportNotice /> : hiddenCount > 0 ? (
                                <Text style={styles.moreNotice}>
                                    검색 결과 {search.totalElements}개 중 {results.length}개만 보여드려요.{'\n'}역 이름을 더 입력해 보세요.
                                </Text>
                            ) : null
                        }
                        renderItem={({ item }) => (
                            <View>
                                <StationRow
                                    station={item}
                                    recent={showRecent}
                                    selected={item.id === selectedStationId}
                                    onPress={() => choose(item)}
                                />
                            </View>
                        )}
                    />
                )}
            </KeyboardAvoidingView>

            {/* 미제공 역 안내 바텀시트 */}
            <UnsupportedSheet
                station={unsupported}
                nearby={nearby}
                bottomInset={insets.bottom}
                onClose={() => setUnsupported(null)}
                onPickNearby={chooseNearby}
            />
        </View>
    );
}

/* ───────────────────────── 역 한 줄 ───────────────────────── */

function StationRow({
                        station,
                        recent,
                        selected,
                        onPress,
                    }: {
    station: Station;
    recent: boolean;
    selected: boolean;
    onPress: () => void;
}) {
    const supported = station.isSupported;

    return (
        <Pressable
            style={({ pressed }) => [
                styles.row,
                !supported && styles.rowUnsupported,
                pressed && styles.rowPressed,
            ]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={supported ? formatStationName(station.name) : `${formatStationName(station.name)}, 미제공 역`}
        >
            <Ionicons name={recent ? 'time-outline' : 'search'} size={16} color={LV_ROW_ICON} />

            <StationName name={station.name} />

            {station.lines.length > 0 && (
                <View style={styles.lines}>
                    {station.lines.map((line) => (
                        <LineDot key={line.lineId} line={line} />
                    ))}
                </View>
            )}

            {!supported && (
                <View style={styles.naBadge}>
                    <Text style={styles.naBadgeText}>미제공</Text>
                </View>
            )}

            {selected && (
                <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={LV_MAIN}
                    style={supported ? styles.checkEnd : styles.check}
                />
            )}
        </Pressable>
    );
}

/** 시안 목록의 노선 원(18, 글자 10.5/700). 숫자가 아닌 노선은 알약형으로 늘려요. */
function LineDot({ line }: { line: StationLine }) {
    const short = line.lineName.replace(/호선$/, '');
    const isNumeric = /^\d+$/.test(short);
    const label = isNumeric ? short : line.lineName.replace(/선$/, '');

    return (
        <View
            style={[styles.lineDot, !isNumeric && styles.lineDotWide, { backgroundColor: line.color }]}
            accessibilityLabel={line.lineName}
        >
            <Text style={styles.lineDotText} numberOfLines={1}>{label}</Text>
        </View>
    );
}

/** 역 이름 (한 가지 스타일) */
function StationName({ name }: { name: string }) {
    return <Text style={styles.name} numberOfLines={1}>{formatStationName(name.trim())}</Text>;
}

/* ───────────────────────── 상태 뷰 ───────────────────────── */

function RecentEmpty() {
    return (
        <View style={styles.status}>
            <Text style={styles.statusText}>최근 검색한 역이 없어요</Text>
        </View>
    );
}

function SupportNotice() {
    return (
        <Text style={styles.supportNote}>
            서울교통공사 1~8호선 역을 지원해요. 그 밖의 역은{' '}
            <Text style={styles.supportNoteStrong}>미제공</Text>으로 표시되고 선택할 수 없어요.
        </Text>
    );
}

function NoResults({ keyword, onRetry }: { keyword: string; onRetry: (text: string) => void }) {
    const mock = isMockMode();
    // 입력을 앞에서부터 줄여가며 결과가 나오는 가장 긴 접두어를 제안
    const suggestions = useMemo(() => {
        if (!mock) return [];
        const found: string[] = [];
        for (let len = keyword.length - 1; len >= 2 && found.length < 2; len -= 1) {
            const prefix = keyword.slice(0, len);
            if (searchStations(prefix).length > 0 && !found.includes(prefix)) found.push(prefix);
        }
        return found;
    }, [keyword, mock]);

    return (
        <View style={styles.status}>
            <Text style={styles.statusText}>일치하는 역이 없어요</Text>
            {suggestions.length > 0 && (
                <View style={styles.suggestRow}>
                    {suggestions.map((text) => (
                        <Pressable key={text} style={styles.suggestChip} onPress={() => onRetry(text)}>
                            <Ionicons name="search" size={13} color={LV_MAIN} />
                            <Text style={styles.suggestText}>{text}</Text>
                        </Pressable>
                    ))}
                </View>
            )}
        </View>
    );
}

/* ───────────────────────── 미제공 바텀시트 ───────────────────────── */

function UnsupportedSheet({
                              station,
                              nearby,
                              bottomInset,
                              onClose,
                              onPickNearby,
                          }: {
    station: Station | null;
    nearby: NearbyStation[];
    bottomInset: number;
    onClose: () => void;
    onPickNearby: (station: Station) => void;
}) {
    const visible = station !== null;
    const lineNames = station?.lines.map((line) => line.lineName).join(' ') ?? '';

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="닫기" />
            <View style={[styles.sheet, { paddingBottom: bottomInset + 20 }]}>
                <View style={styles.grabber} />

                <View style={styles.sheetStation}>
                    <View style={styles.sheetStationIcon}>
                        <Ionicons name="train-outline" size={22} color={LV_ROW_ICON} />
                    </View>
                    <View style={styles.sheetStationBody}>
                        <View style={styles.sheetNameRow}>
                            <Text style={styles.sheetStationName}>{formatStationName(station?.name)}</Text>
                            <View style={styles.naBadge}>
                                <Text style={styles.naBadgeText}>미제공</Text>
                            </View>
                        </View>
                        <Text style={styles.sheetSubtitle}>{lineNames} 데이터 미제공 구간</Text>
                    </View>
                </View>

                <Text style={styles.sheetTitle}>이 역은 아직 선택할 수 없어요</Text>
                <Text style={styles.sheetDescription}>
                    LinkRo는 지금 <Text style={styles.sheetBold}>서울교통공사 1~8호선</Text> 역의 경로 혼잡도 데이터를 제공해요.
                    코레일 신분당선 등 다른 운영사 구간은 준비 중이에요.
                </Text>

                {nearby.length > 0 && (
                    <View style={styles.nearbyBox}>
                        <Text style={styles.nearbyTitle}>대신 이런 역은 어떠세요?</Text>
                        <View style={styles.nearbyRow}>
                            {nearby.map(({ station: near, walkMinutes }) => (
                                <Pressable
                                    key={near.id}
                                    style={styles.nearbyChip}
                                    onPress={() => onPickNearby(near)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${formatStationName(near.name)} 선택, 도보 ${walkMinutes}분`}
                                >
                                    <LineBadge line={near.lines[0]} size={18} />
                                    <Text style={styles.suggestText}>{formatStationName(near.name)}</Text>
                                    <Text style={styles.nearbyWalk}>도보 {walkMinutes}분</Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>
                )}

                <Pressable
                    style={({ pressed }) => [styles.sheetButton, pressed && styles.pressed]}
                    onPress={onClose}
                    accessibilityRole="button"
                >
                    <Text style={styles.sheetButtonText}>다른 역 검색하기</Text>
                </Pressable>
            </View>
        </Modal>
    );
}

/* ───────────────────────── 스타일 ───────────────────────── */

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: LV_BACKGROUND,
    },

    moreNotice: {
        marginTop: 14,
        color: LV_SECONDARY,
        fontSize: 13,
        lineHeight: 19,
        textAlign: 'center',
    },

    header: { height: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
    backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, minWidth: 0, paddingLeft: 8, fontSize: 20, fontWeight: '700', color: LV_TEXT },

    // 입력 카드
    searchWrap: {
        paddingTop: 8,
        paddingHorizontal: 20,
    },

    search: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 6,
        paddingRight: 6,
        paddingBottom: 6,
        paddingLeft: 16,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: LV_CARD_BORDER,
        backgroundColor: LV_CARD,
    },

    point: {
        width: 10,
        height: 10,
        marginRight: 12,
        borderRadius: 5,
    },

    pointFilled: {
        backgroundColor: LV_MAIN,
    },

    pointOutline: {
        borderWidth: 2.5,
        borderColor: LV_MAIN,
        backgroundColor: LV_CARD,
    },

    input: {
        flex: 1,
        minWidth: 0,
        height: 46,
        fontSize: 16.5,
        fontWeight: '600',
        color: LV_TEXT,
        paddingVertical: 0,
        ...Platform.select({ web: { outlineStyle: 'none' } as object }),
    },

    clearButton: {
        width: 22,
        height: 22,
        marginRight: 10,
        marginLeft: 6,
        borderRadius: 11,
        backgroundColor: LV_CLEAR,
        alignItems: 'center',
        justifyContent: 'center',
    },

    cancelButton: {
        minWidth: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },

    cancelText: {
        fontSize: 13.5,
        fontWeight: '600',
        color: LV_MAIN,
    },

    // 목록
    listArea: {
        flex: 1,
    },

    listContent: {
        paddingHorizontal: 20,
    },

    sectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 22,
        marginBottom: 4,
    },

    sectionTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: LV_TEXT,
    },

    sectionAction: {
        height: 32,
        justifyContent: 'center',
    },

    sectionActionText: {
        fontSize: 12.5,
        color: LV_SECONDARY,
    },

    row: {
        height: 50,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: LV_ROW_DIVIDER,
    },

    rowUnsupported: {
        opacity: 0.5,
    },

    rowPressed: {
        backgroundColor: LV_PRESSED,
    },

    name: {
        flexShrink: 1,
        fontSize: 15.5,
        color: LV_TEXT,
    },

    lines: {
        flexDirection: 'row',
        gap: 3,
    },

    lineDot: {
        height: 18,
        minWidth: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },

    lineDotWide: {
        paddingHorizontal: 6,
    },

    lineDotText: {
        fontSize: 10.5,
        fontWeight: '700',
        color: '#FFFFFF',
        includeFontPadding: false,
    },

    naBadge: {
        marginLeft: 'auto',
        paddingVertical: 3,
        paddingHorizontal: 7,
        borderRadius: 6,
        backgroundColor: LV_BADGE_BACKGROUND,
    },

    naBadgeText: {
        fontSize: 11,
        color: LV_SECONDARY,
    },

    check: {
        marginLeft: 2,
    },

    checkEnd: {
        marginLeft: 'auto',
    },

    // 불러오는 중 / 오류 / 결과 없음 / 최근 없음
    status: {
        paddingVertical: 30,
        paddingHorizontal: 20,
        alignItems: 'center',
    },

    statusTitle: {
        marginBottom: 6,
        fontSize: 15,
        fontWeight: '700',
        color: LV_TEXT,
        textAlign: 'center',
    },

    statusText: {
        fontSize: 14,
        lineHeight: 20,
        color: LV_SECONDARY,
        textAlign: 'center',
    },

    suggestRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 8,
    },

    suggestChip: {
        height: 36,
        marginTop: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        borderRadius: 999,
        backgroundColor: LV_CARD,
        borderWidth: 1,
        borderColor: LV_CARD_BORDER,
    },

    suggestText: {
        fontSize: 13,
        fontWeight: '600',
        color: LV_MAIN,
    },

    // 시안(#184)의 아래 안내 문구 자리 — 글자만 있어요.
    supportNote: {
        marginTop: 22,
        color: LV_SECONDARY,
        fontSize: 12,
        lineHeight: 19.2,
    },

    supportNoteStrong: {
        fontWeight: '700',
    },

    // 바텀시트
    dim: {
        flex: 1,
        backgroundColor: LV_DIM,
    },

    sheet: {
        backgroundColor: LV_CARD,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 20,
        paddingTop: 12,
        gap: 18,
    },

    grabber: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: LV_CARD_BORDER,
        alignSelf: 'center',
    },

    sheetStation: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: 16,
        backgroundColor: LV_BACKGROUND,
    },

    sheetStationIcon: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: LV_CARD,
        borderWidth: 1,
        borderColor: LV_CARD_BORDER,
        alignItems: 'center',
        justifyContent: 'center',
    },

    sheetStationBody: {
        flex: 1,
        gap: 3,
    },

    sheetNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    sheetStationName: {
        fontSize: 17,
        fontWeight: '700',
        color: LV_TEXT,
    },

    sheetSubtitle: {
        fontSize: 12,
        color: LV_SECONDARY,
    },

    sheetTitle: {
        fontSize: 19,
        lineHeight: 25,
        fontWeight: '700',
        color: LV_TEXT,
    },

    sheetDescription: {
        marginTop: -10,
        fontSize: 14,
        lineHeight: 22,
        color: LV_SECONDARY,
    },

    sheetBold: {
        fontWeight: '700',
        color: LV_TEXT,
    },

    nearbyBox: {
        padding: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        backgroundColor: LV_SOFT,
    },

    nearbyTitle: {
        fontSize: 12,
        fontWeight: '700',
        color: LV_MAIN,
    },

    nearbyRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 10,
    },

    nearbyChip: {
        height: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        borderRadius: 999,
        backgroundColor: LV_CARD,
    },

    nearbyWalk: {
        fontSize: 13,
        color: LV_SECONDARY,
    },

    sheetButton: {
        height: 54,
        borderRadius: 16,
        backgroundColor: LV_MAIN,
        alignItems: 'center',
        justifyContent: 'center',
    },

    sheetButtonText: {
        fontSize: 15,
        fontWeight: '700',
        color: LV_CARD,
    },

    pressed: {
        opacity: 0.85,
    },
});
