/**
 * 역 검색·선택 화면 (이슈 #33) — 단일 파일 버전
 *
 * 이 파일 하나에 화면 + mock 데이터 + 호출 헬퍼 + 노선 배지가 모두 들어 있다.
 * 다른 화면에서는 아래처럼 쓴다:
 *
 *   import { openStationPicker, type Station } from '@/app/station-search';
 *   openStationPicker({ purpose: 'origin' }, (station) => setOrigin(station));
 *
 * 구성 (위에서부터)
 *   1. 타입 재공개·mock 데이터·기존 mock 검색 함수
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
    Text,
    TextInput,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { searchStations as fetchStationSearch } from '@/services/station';
import { useMock } from '@/services/api/config';
import { ApiError } from '@/services/api/errors';
import type { Station, StationLine } from '@/types/station';

export type { Station, StationLine } from '@/types/station';

/* ═══════════════ 1. 타입 · mock 데이터 · 검색 ═══════════════ */

/**
 * 역 검색 mock 데이터.
 * API 명세 5.2 `GET /stations?keyword=` 응답의 items[] 형태를 그대로 따른다.
 * 화면의 실제 검색은 services/station.ts를 거치고, mock 분기는 아래 검색 함수를 재사용한다.
 *
 * - id: 숫자 (명세: stationId, lineId는 숫자)
 * - isSupported: 서울교통공사 1~8호선 데이터 보유 역만 true. 코레일·신분당 등은 false ("미제공")
 * - lines[].color: 서버가 내려주는 값. 화면은 이 값을 그대로 쓴다.
 */

// 노선 마스터 (명세 5.1 GET /lines)
const LINE = {
    1: { lineId: 1, lineName: '1호선', color: '#0052A4' },
    2: { lineId: 2, lineName: '2호선', color: '#00A84D' },
    3: { lineId: 3, lineName: '3호선', color: '#EF7C1C' },
    4: { lineId: 4, lineName: '4호선', color: '#00A5DE' },
    5: { lineId: 5, lineName: '5호선', color: '#996CAC' },
    6: { lineId: 6, lineName: '6호선', color: '#CD7C2F' },
    7: { lineId: 7, lineName: '7호선', color: '#747F00' },
    8: { lineId: 8, lineName: '8호선', color: '#E6186C' },
    // 아래는 미제공 구간용 (코레일·민자)
    9: { lineId: 9, lineName: '9호선', color: '#BDB092' },
    101: { lineId: 101, lineName: '수인분당선', color: '#F5A200' },
    102: { lineId: 102, lineName: '신분당선', color: '#D4003B' },
    103: { lineId: 103, lineName: '경의중앙선', color: '#77C4A3' },
    104: { lineId: 104, lineName: '공항철도', color: '#0090D2' },
} as const;

type LineKey = keyof typeof LINE;

function line(key: LineKey, stationCode: string): StationLine {
    return { ...LINE[key], stationCode };
}

export const MOCK_STATIONS: Station[] = [
    { id: 101, name: '서울역', latitude: 37.5547, longitude: 126.9707, isSupported: true, lines: [line(1, '133'), line(4, '426')] },
    { id: 102, name: '시청', latitude: 37.5657, longitude: 126.9769, isSupported: true, lines: [line(1, '132'), line(2, '201')] },
    { id: 103, name: '종로3가', latitude: 37.5714, longitude: 126.9918, isSupported: true, lines: [line(1, '130'), line(3, '329'), line(5, '534')] },
    { id: 104, name: '동대문역사문화공원', latitude: 37.5651, longitude: 127.0092, isSupported: true, lines: [line(2, '205'), line(4, '422'), line(5, '536')] },
    { id: 105, name: '강남', latitude: 37.4979, longitude: 127.0276, isSupported: true, lines: [line(2, '222')] },
    { id: 106, name: '강남구청', latitude: 37.5172, longitude: 127.0411, isSupported: true, lines: [line(7, '730')] },
    { id: 107, name: '역삼', latitude: 37.5006, longitude: 127.0364, isSupported: true, lines: [line(2, '221')] },
    { id: 108, name: '교대', latitude: 37.4934, longitude: 127.0142, isSupported: true, lines: [line(2, '223'), line(3, '340')] },
    { id: 109, name: '사당', latitude: 37.4765, longitude: 126.9816, isSupported: true, lines: [line(2, '226'), line(4, '433')] },
    { id: 110, name: '서울대입구', latitude: 37.4813, longitude: 126.9527, isSupported: true, lines: [line(2, '228')] },
    { id: 111, name: '신림', latitude: 37.4842, longitude: 126.9296, isSupported: true, lines: [line(2, '230')] },
    { id: 112, name: '홍대입구', latitude: 37.5574, longitude: 126.9245, isSupported: true, lines: [line(2, '239')] },
    { id: 113, name: '신촌', latitude: 37.5551, longitude: 126.9368, isSupported: true, lines: [line(2, '240')] },
    { id: 114, name: '건대입구', latitude: 37.5403, longitude: 127.0702, isSupported: true, lines: [line(2, '212'), line(7, '727')] },
    { id: 115, name: '성수', latitude: 37.5446, longitude: 127.0559, isSupported: true, lines: [line(2, '211')] },
    { id: 116, name: '뚝섬', latitude: 37.5473, longitude: 127.0474, isSupported: true, lines: [line(2, '210')] },
    { id: 117, name: '강변', latitude: 37.5352, longitude: 127.0946, isSupported: true, lines: [line(2, '214')] },
    { id: 118, name: '잠실', latitude: 37.5133, longitude: 127.1001, isSupported: true, lines: [line(2, '216'), line(8, '814')] },
    { id: 119, name: '왕십리', latitude: 37.5614, longitude: 127.0375, isSupported: true, lines: [line(2, '208'), line(5, '540')] },
    { id: 120, name: '노원', latitude: 37.6553, longitude: 127.0614, isSupported: true, lines: [line(4, '411'), line(7, '711')] },
    { id: 121, name: '충무로', latitude: 37.5613, longitude: 126.9941, isSupported: true, lines: [line(3, '331'), line(4, '423')] },
    { id: 122, name: '을지로입구', latitude: 37.5660, longitude: 126.9826, isSupported: true, lines: [line(2, '202')] },
    { id: 123, name: '합정', latitude: 37.5498, longitude: 126.9139, isSupported: true, lines: [line(2, '238'), line(6, '622')] },
    { id: 124, name: '고속터미널', latitude: 37.5049, longitude: 127.0049, isSupported: true, lines: [line(3, '339'), line(7, '734')] },
    { id: 125, name: '천호', latitude: 37.5387, longitude: 127.1238, isSupported: true, lines: [line(5, '547'), line(8, '811')] },

    // 미제공 (서울교통공사 데이터 범위 밖)
    { id: 901, name: '서울숲', latitude: 37.5436, longitude: 127.0444, isSupported: false, lines: [line(101, 'K211')] },
    { id: 902, name: '용산', latitude: 37.5299, longitude: 126.9648, isSupported: false, lines: [line(1, '135'), line(103, 'K110')] },
    { id: 903, name: '판교', latitude: 37.3948, longitude: 127.1112, isSupported: false, lines: [line(102, 'D11')] },
    { id: 904, name: '수원', latitude: 37.2659, longitude: 127.0001, isSupported: false, lines: [line(1, 'P155'), line(101, 'K245')] },
    { id: 905, name: '홍대입구 (공항철도)', latitude: 37.5577, longitude: 126.9250, isSupported: false, lines: [line(104, 'A03')] },
    { id: 906, name: '여의도', latitude: 37.5216, longitude: 126.9243, isSupported: false, lines: [line(5, '527'), line(9, '915')] },
];

/** 역명 정규화: 공백 제거, 끝의 '역' 제거, 괄호 부역명 분리 */
export function normalizeStationName(value: string): string {
    return value
        .replace(/\s+/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/역$/, '')
        .toLowerCase();
}

/**
 * mock 검색. 명세 5.2처럼 keyword 부분 일치, 최대 50건.
 * 괄호 안 부역명도 검색 대상에 포함한다 (예: "강변" → "동서울터미널(강변)" 형태 대응).
 */
export function searchStations(keyword: string, limit = 50): Station[] {
    const q = normalizeStationName(keyword);
    if (!q) return [];

    const scored = MOCK_STATIONS
        .map((station) => {
            const name = normalizeStationName(station.name);
            const full = station.name.replace(/\s+/g, '').toLowerCase();
            let score = -1;
            if (name === q) score = 0;
            else if (name.startsWith(q)) score = 1;
            else if (name.includes(q)) score = 2;
            else if (full.includes(q)) score = 3;
            return { station, score };
        })
        .filter((item) => item.score >= 0)
        .sort((a, b) => {
            if (a.score !== b.score) return a.score - b.score;
            if (a.station.isSupported !== b.station.isSupported) return a.station.isSupported ? -1 : 1;
            return a.station.name.localeCompare(b.station.name, 'ko');
        });

    return scored.slice(0, limit).map((item) => item.station);
}

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
    return MOCK_STATIONS
        .filter((station) => station.isSupported && station.id !== origin.id)
        .map((station) => ({ station, meters: distanceMeters(origin, station) }))
        .sort((a, b) => a.meters - b.meters)
        .slice(0, count)
        .map(({ station, meters }) => ({ station, walkMinutes: Math.max(1, Math.round(meters / 67)) }));
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

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const MINT_DEEP = '#12a77a';
const MINT_SOFT = '#e6f8f1';
const MINT_TEXT = '#0f6b4f';
const PURPLE = '#4d3fc7';
const PURPLE_SOFT = '#ece9fb';
const BG = '#f3f5f8';
const WHITE = '#ffffff';
const SECONDARY = '#6b7488';
const DISABLED = '#9aa3b2';
const BORDER = '#e6e9ef';
const ROW_DIVIDER = '#eef0f4';

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
        loading: boolean;
        error: string | null;
    }>({ keyword: '', items: [], loading: false, error: null });

    const trimmed = query.trim();
    const results = search.keyword === trimmed ? search.items : [];
    const searching = search.keyword !== trimmed || search.loading;
    const searchError = search.keyword === trimmed ? search.error : null;
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
        setSearch({ keyword: trimmed, items: [], loading: !!trimmed, error: null });
        if (trimmed) {
            fetchStationSearch(trimmed).then(result => {
                if (active) setSearch({ keyword: trimmed, items: result.items, loading: false, error: null });
            }).catch(error => {
                if (active) setSearch({
                    keyword: trimmed,
                    items: [],
                    loading: false,
                    error: error instanceof ApiError ? error.message : '역 정보를 불러오지 못했어요. 다시 시도해 주세요.',
                });
            });
        }
        // 이전 검색이나 닫힌 화면의 응답이 현재 결과를 덮어쓰지 않도록 합니다.
        return () => { active = false; };
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

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 헤더: 뒤로가기 + 용도 칩 + 질문형 제목 */}
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <View style={styles.headerRow}>
                    <Pressable
                        style={styles.backButton}
                        onPress={goBack}
                        accessibilityRole="button"
                        accessibilityLabel="뒤로 가기"
                        hitSlop={8}
                    >
                        <Ionicons name="chevron-back" size={26} color={NAVY} />
                    </Pressable>

                    <View style={[styles.chip, purpose === 'departure' ? styles.chipPurple : styles.chipMint]}>
                        <Text style={[styles.chipText, purpose === 'departure' ? styles.chipTextPurple : styles.chipTextMint]}>
                            {copy.chip}
                        </Text>
                    </View>
                </View>

                <Text style={styles.title}>{copy.title}</Text>
            </View>

            {/* 검색창 */}
            <View style={styles.searchWrap}>
                <Pressable
                    style={[styles.search, focused && styles.searchFocused]}
                    onPress={() => inputRef.current?.focus()}
                >
                    <Ionicons name="search" size={20} color={focused ? NAVY : SECONDARY} />
                    <TextInput
                        ref={inputRef}
                        style={styles.input}
                        value={query}
                        onChangeText={setQuery}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        placeholder="역 이름을 입력하세요"
                        placeholderTextColor="#a2a9b5"
                        returnKeyType="search"
                        autoCorrect={false}
                        autoCapitalize="none"
                        selectionColor={MINT}
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
                            <Ionicons name="close" size={13} color={WHITE} />
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
                    <View style={styles.noResults}>
                        <Text style={styles.emptyDescription}>{searchError ?? '역을 검색하고 있어요'}</Text>
                        {searchError && (
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
                            showRecent ? (
                                recent.length > 0 ? (
                                    <View style={styles.sectionRow}>
                                        <Text style={styles.sectionTitle}>최근 검색</Text>
                                        <Pressable onPress={handleClearRecent} hitSlop={8}>
                                            <Text style={styles.sectionAction}>전체 지우기</Text>
                                        </Pressable>
                                    </View>
                                ) : null
                            ) : (
                                <View style={styles.sectionRow}>
                                    <Text style={styles.sectionTitle}>
                                        검색 결과 <Text style={styles.sectionCount}>{results.length}</Text>
                                    </Text>
                                    {unsupportedCount > 0 && (
                                        <Text style={styles.sectionMuted}>미제공 {unsupportedCount}</Text>
                                    )}
                                </View>
                            )
                        }
                        ListEmptyComponent={
                            showRecent ? <RecentEmpty /> : null
                        }
                        ListFooterComponent={
                            showRecent ? <SupportNotice /> : null
                        }
                        renderItem={({ item, index }) => (
                            <View style={[styles.card, index === 0 && styles.cardTop, index === data.length - 1 && styles.cardBottom]}>
                                <StationRow
                                    station={item}
                                    keyword={showRecent ? '' : trimmed}
                                    recent={showRecent}
                                    selected={item.id === selectedStationId}
                                    last={index === data.length - 1}
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
                        keyword,
                        recent,
                        selected,
                        last,
                        onPress,
                    }: {
    station: Station;
    keyword: string;
    recent: boolean;
    selected: boolean;
    last: boolean;
    onPress: () => void;
}) {
    const supported = station.isSupported;
    const lineNames = station.lines.map((line) => line.lineName).join(' · ');
    const subtitle = supported
        ? station.lines.length > 1 ? `${lineNames} · 환승역` : lineNames
        : `${lineNames} · 데이터 미제공 구간`;

    return (
        <Pressable
            style={({ pressed }) => [
                styles.row,
                !last && styles.rowDivider,
                !supported && styles.rowUnsupported,
                pressed && styles.rowPressed,
            ]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={supported ? station.name : `${station.name}, 미제공 역`}
        >
            {/* 노선색 레일 (환승역은 분할, 미제공은 점선) */}
            <View style={styles.rail}>
                {supported ? (
                    station.lines.map((line) => (
                        <View key={line.lineId} style={[styles.railSegment, { backgroundColor: line.color }]} />
                    ))
                ) : (
                    <DashedRail />
                )}
            </View>

            {recent && (
                <View style={styles.recentIcon}>
                    <Ionicons name="time-outline" size={18} color="#8b95a4" />
                </View>
            )}

            <View style={styles.rowBody}>
                <View style={styles.nameRow}>
                    <HighlightedName name={station.name} keyword={keyword} muted={!supported} />
                    {!supported && (
                        <View style={styles.naBadge}>
                            <Text style={styles.naBadgeText}>미제공</Text>
                        </View>
                    )}
                </View>
                <Text style={[styles.subtitle, !supported && styles.subtitleMuted]} numberOfLines={1}>
                    {subtitle}
                </Text>
            </View>

            <View style={styles.badges}>
                {station.lines.map((line) => (
                    <LineBadge key={line.lineId} line={line} muted={!supported} />
                ))}
            </View>

            {selected && (
                <Ionicons name="checkmark-circle" size={22} color={MINT_DEEP} style={styles.check} />
            )}
            {recent && !selected && (
                <Ionicons name="chevron-forward" size={18} color="#c0c6d1" />
            )}
        </Pressable>
    );
}

function DashedRail() {
    return (
        <View style={styles.dashedRail}>
            {Array.from({ length: 7 }).map((_, i) => (
                <View key={i} style={styles.dash} />
            ))}
        </View>
    );
}

/** 검색어와 일치하는 부분을 민트로 강조 */
function HighlightedName({ name, keyword, muted }: { name: string; keyword: string; muted: boolean }) {
    const base = [styles.name, muted && styles.nameMuted];
    const q = normalizeStationName(keyword);
    const lower = name.toLowerCase();
    const index = q ? lower.indexOf(q) : -1;

    if (index < 0) {
        return <Text style={base} numberOfLines={1}>{name}</Text>;
    }

    return (
        <Text style={base} numberOfLines={1}>
            {name.slice(0, index)}
            <Text style={muted ? undefined : styles.nameHit}>{name.slice(index, index + q.length)}</Text>
            {name.slice(index + q.length)}
        </Text>
    );
}

/* ───────────────────────── 상태 뷰 ───────────────────────── */

function RecentEmpty() {
    return (
        <View style={styles.recentEmpty}>
            <View style={styles.emptyIcon}>
                <Ionicons name="time-outline" size={30} color="#b0b6c2" />
            </View>
            <Text style={styles.emptyTitle}>최근 검색한 역이 없어요</Text>
            <Text style={styles.emptyDescription}>역 이름을 검색해 이동을 시작해보세요</Text>
        </View>
    );
}

function SupportNotice() {
    return (
        <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={18} color={MINT_DEEP} style={styles.noticeIcon} />
            <Text style={styles.noticeText}>
                서울교통공사 1~8호선 역을 지원해요. 그 밖의 역은{' '}
                <Text style={styles.noticeBold}>미제공</Text>으로 표시되고 선택할 수 없어요.
            </Text>
        </View>
    );
}

function NoResults({ keyword, onRetry }: { keyword: string; onRetry: (text: string) => void }) {
    const mock = useMock();
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
        <View style={styles.noResults}>
            <View style={styles.emptyIcon}>
                <Ionicons name="search-outline" size={32} color="#b0b6c2" />
            </View>
            <Text style={styles.emptyTitle}>‘{keyword}’와 일치하는{'\n'}역이 없어요</Text>
            <Text style={styles.emptyDescription}>역 이름만 짧게 입력해 보세요.{'\n'}‘역’ 글자는 빼도 돼요.</Text>
            {suggestions.length > 0 && (
                <View style={styles.suggestRow}>
                    {suggestions.map((text) => (
                        <Pressable key={text} style={styles.suggestChip} onPress={() => onRetry(text)}>
                            <Ionicons name="search" size={13} color={NAVY} />
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
    const lineNames = station?.lines.map((line) => line.lineName).join(' · ') ?? '';

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="닫기" />
            <View style={[styles.sheet, { paddingBottom: bottomInset + 20 }]}>
                <View style={styles.grabber} />

                <View style={styles.sheetStation}>
                    <View style={styles.sheetStationIcon}>
                        <Ionicons name="train-outline" size={22} color={DISABLED} />
                    </View>
                    <View style={styles.sheetStationBody}>
                        <View style={styles.nameRow}>
                            <Text style={styles.sheetStationName}>{station?.name}</Text>
                            <View style={styles.naBadge}>
                                <Text style={styles.naBadgeText}>미제공</Text>
                            </View>
                        </View>
                        <Text style={styles.subtitle}>{lineNames} · 데이터 미제공 구간</Text>
                    </View>
                </View>

                <Text style={styles.sheetTitle}>이 역은 아직 선택할 수 없어요</Text>
                <Text style={styles.sheetDescription}>
                    LinkRo는 지금 <Text style={styles.sheetBold}>서울교통공사 1~8호선</Text> 역의 경로·혼잡도 데이터를 제공해요.
                    코레일·신분당선 등 다른 운영사 구간은 준비 중이에요.
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
                                    accessibilityLabel={`${near.name} 선택, 도보 ${walkMinutes}분`}
                                >
                                    <LineBadge line={near.lines[0]} size={18} />
                                    <Text style={styles.suggestText}>{near.name}</Text>
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

const RAIL_WIDTH = 6;
const ROW_HEIGHT = 70;

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BG,
    },

    // 헤더
    header: {
        paddingHorizontal: 20,
        paddingBottom: 14,
        gap: 12,
    },

    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },

    backButton: {
        width: 44,
        height: 44,
        marginLeft: -10,
        alignItems: 'center',
        justifyContent: 'center',
    },

    chip: {
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: 999,
    },

    chipMint: { backgroundColor: MINT_SOFT },
    chipPurple: { backgroundColor: PURPLE_SOFT },

    chipText: {
        fontSize: 12,
        fontWeight: '700',
    },

    chipTextMint: { color: MINT_DEEP },
    chipTextPurple: { color: PURPLE },

    title: {
        fontSize: 26,
        lineHeight: 33,
        fontWeight: '800',
        color: NAVY,
        letterSpacing: -0.6,
    },

    // 검색창
    searchWrap: {
        paddingHorizontal: 20,
        paddingTop: 4,
    },

    search: {
        height: 54,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        borderRadius: 16,
        backgroundColor: WHITE,
        borderWidth: 2,
        borderColor: BORDER,
    },

    searchFocused: {
        borderColor: NAVY,
        shadowColor: NAVY,
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
    },

    input: {
        flex: 1,
        minWidth: 0,
        fontSize: 16,
        fontWeight: '600',
        color: NAVY,
        paddingVertical: 0,
        ...Platform.select({ web: { outlineStyle: 'none' } as object }),
    },

    clearButton: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#c8cdd6',
        alignItems: 'center',
        justifyContent: 'center',
    },

    // 목록
    listArea: {
        flex: 1,
    },

    listContent: {
        paddingHorizontal: 20,
        paddingTop: 22,
    },

    sectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 2,
        marginBottom: 10,
    },

    sectionTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: SECONDARY,
    },

    sectionCount: {
        color: NAVY,
        fontWeight: '800',
    },

    sectionAction: {
        fontSize: 12,
        fontWeight: '700',
        color: '#9ca3b2',
        paddingVertical: 4,
    },

    sectionMuted: {
        fontSize: 12,
        fontWeight: '600',
        color: '#9ca3b2',
    },

    card: {
        backgroundColor: WHITE,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: BORDER,
        overflow: 'hidden',
    },

    cardTop: {
        borderTopWidth: 1,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
    },

    cardBottom: {
        borderBottomWidth: 1,
        borderBottomLeftRadius: 18,
        borderBottomRightRadius: 18,
    },

    row: {
        minHeight: ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingRight: 16,
    },

    rowDivider: {
        borderBottomWidth: 1,
        borderBottomColor: ROW_DIVIDER,
    },

    rowUnsupported: {
        backgroundColor: '#fafbfc',
    },

    rowPressed: {
        backgroundColor: '#f6f8fa',
    },

    rail: {
        width: RAIL_WIDTH,
        alignSelf: 'stretch',
        flexDirection: 'column',
    },

    railSegment: {
        flex: 1,
    },

    dashedRail: {
        flex: 1,
        justifyContent: 'space-evenly',
    },

    dash: {
        width: RAIL_WIDTH,
        height: 6,
        backgroundColor: '#d5d9e1',
    },

    recentIcon: {
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: BG,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 4,
    },

    rowBody: {
        flex: 1,
        minWidth: 0,
        gap: 3,
        paddingLeft: 4,
    },

    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    name: {
        fontSize: 16,
        fontWeight: '700',
        color: NAVY,
        letterSpacing: -0.3,
        flexShrink: 1,
    },

    nameMuted: {
        color: DISABLED,
    },

    nameHit: {
        color: MINT_DEEP,
    },

    subtitle: {
        fontSize: 12,
        fontWeight: '500',
        color: SECONDARY,
    },

    subtitleMuted: {
        color: '#a1a8b8',
    },

    naBadge: {
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: '#eceff3',
    },

    naBadgeText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: SECONDARY,
        letterSpacing: 0.2,
    },

    badges: {
        flexDirection: 'row',
        gap: 4,
    },

    check: {
        marginLeft: 2,
    },

    // 빈 상태 / 결과 없음
    recentEmpty: {
        alignItems: 'center',
        paddingTop: 70,
        paddingBottom: 30,
    },

    noResults: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        paddingBottom: 60,
    },

    emptyIcon: {
        width: 76,
        height: 76,
        borderRadius: 24,
        backgroundColor: WHITE,
        borderWidth: 1,
        borderColor: BORDER,
        alignItems: 'center',
        justifyContent: 'center',
    },

    emptyTitle: {
        marginTop: 18,
        fontSize: 16,
        lineHeight: 22,
        fontWeight: '800',
        color: NAVY,
        textAlign: 'center',
        letterSpacing: -0.3,
    },

    emptyDescription: {
        marginTop: 8,
        fontSize: 13,
        lineHeight: 20,
        fontWeight: '500',
        color: SECONDARY,
        textAlign: 'center',
    },

    suggestRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 8,
        marginTop: 22,
    },

    suggestChip: {
        height: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        borderRadius: 999,
        backgroundColor: WHITE,
        borderWidth: 1,
        borderColor: BORDER,
    },

    suggestText: {
        fontSize: 13,
        fontWeight: '700',
        color: NAVY,
    },

    notice: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        marginTop: 18,
        padding: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        backgroundColor: MINT_SOFT,
    },

    noticeIcon: {
        marginTop: 1,
    },

    noticeText: {
        flex: 1,
        fontSize: 12.5,
        lineHeight: 19,
        fontWeight: '500',
        color: MINT_TEXT,
    },

    noticeBold: {
        fontWeight: '700',
    },

    // 바텀시트
    dim: {
        flex: 1,
        backgroundColor: 'rgba(15,28,63,0.42)',
    },

    sheet: {
        backgroundColor: WHITE,
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
        backgroundColor: '#d9dde4',
        alignSelf: 'center',
    },

    sheetStation: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: 16,
        backgroundColor: BG,
    },

    sheetStationIcon: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: WHITE,
        borderWidth: 1,
        borderColor: BORDER,
        alignItems: 'center',
        justifyContent: 'center',
    },

    sheetStationBody: {
        flex: 1,
        gap: 3,
    },

    sheetStationName: {
        fontSize: 17,
        fontWeight: '800',
        color: NAVY,
        letterSpacing: -0.3,
    },

    sheetTitle: {
        fontSize: 19,
        lineHeight: 25,
        fontWeight: '800',
        color: NAVY,
        letterSpacing: -0.5,
    },

    sheetDescription: {
        marginTop: -10,
        fontSize: 14,
        lineHeight: 22,
        fontWeight: '500',
        color: SECONDARY,
    },

    sheetBold: {
        fontWeight: '700',
        color: NAVY,
    },

    nearbyBox: {
        padding: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        backgroundColor: MINT_SOFT,
    },

    nearbyTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: MINT_TEXT,
        letterSpacing: 0.2,
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
        backgroundColor: WHITE,
    },

    nearbyWalk: {
        fontSize: 13,
        fontWeight: '500',
        color: SECONDARY,
    },

    sheetButton: {
        height: 54,
        borderRadius: 16,
        backgroundColor: NAVY,
        alignItems: 'center',
        justifyContent: 'center',
    },

    sheetButtonText: {
        fontSize: 15,
        fontWeight: '800',
        color: WHITE,
    },

    pressed: {
        opacity: 0.85,
    },
});
