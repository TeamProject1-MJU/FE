
import { useState } from 'react';
import { router } from 'expo-router';
import {
    Keyboard,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const BACKGROUND = '#f3f5f8';
const WHITE = '#ffffff';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';

export default function RouteSearchScreen() {
    const insets = useSafeAreaInsets();

    const [departure, setDeparture] = useState('');
    const [destination, setDestination] = useState('');
    const [searched, setSearched] = useState(false);
    const [error, setError] = useState('');

    const goBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/home');
        }
    };

    const swapStations = () => {
        setDeparture(destination);
        setDestination(departure);
        setSearched(false);
        setError('');
    };

    const handleSearch = () => {
        Keyboard.dismiss();

        const from = departure.trim();
        const to = destination.trim();

        if (!from || !to) {
            setError('출발역과 도착역을 모두 입력해 주세요.');
            setSearched(false);
            return;
        }

        if (from === to) {
            setError('출발역과 도착역을 다르게 설정해 주세요.');
            setSearched(false);
            return;
        }

        setError('');
        setSearched(true);
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 상단 헤더 */}
            <View
                style={[
                    styles.header,
                    { paddingTop: insets.top + 12 },
                ]}
            >
                <Pressable
                    style={styles.backButton}
                    onPress={goBack}
                >
                    <Ionicons
                        name="chevron-back"
                        size={25}
                        color={NAVY}
                    />
                </Pressable>

                <Text style={styles.headerTitle}>
                    경로 탐색
                </Text>

                <View style={styles.headerRight} />
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* 안내 문구 */}
                <View style={styles.intro}>
                    <Text style={styles.title}>
                        어디로 이동하시나요?
                    </Text>

                    <Text style={styles.description}>
                        출발역과 도착역을 설정해 주세요.
                    </Text>
                </View>

                {/* 출발 / 도착역 입력 카드 */}
                <View style={styles.stationCard}>
                    <View style={styles.stationRow}>
                        <View style={styles.pointColumn}>
                            <View style={styles.startPoint} />
                        </View>

                        <View style={styles.stationContent}>
                            <Text style={styles.stationLabel}>
                                출발역
                            </Text>

                            <TextInput
                                style={styles.stationInput}
                                placeholder="출발역을 입력하세요"
                                placeholderTextColor="#a1a8b8"
                                value={departure}
                                onChangeText={(value) => {
                                    setDeparture(value);
                                    setSearched(false);
                                    setError('');
                                }}
                                returnKeyType="next"
                            />
                        </View>
                    </View>

                    <View style={styles.stationDivider} />

                    <View style={styles.stationRow}>
                        <View style={styles.pointColumn}>
                            <View style={styles.endPoint} />
                        </View>

                        <View style={styles.stationContent}>
                            <Text style={styles.stationLabel}>
                                도착역
                            </Text>

                            <TextInput
                                style={styles.stationInput}
                                placeholder="도착역을 입력하세요"
                                placeholderTextColor="#a1a8b8"
                                value={destination}
                                onChangeText={(value) => {
                                    setDestination(value);
                                    setSearched(false);
                                    setError('');
                                }}
                                returnKeyType="done"
                                onSubmitEditing={handleSearch}
                            />
                        </View>
                    </View>

                    {/* 출발역 / 도착역 교환 */}
                    <Pressable
                        style={({ pressed }) => [
                            styles.swapButton,
                            pressed && styles.pressed,
                        ]}
                        onPress={swapStations}
                    >
                        <Ionicons
                            name="swap-vertical"
                            size={22}
                            color={NAVY}
                        />
                    </Pressable>
                </View>

                {/* 입력 오류 */}
                {!!error && (
                    <View style={styles.errorRow}>
                        <Ionicons
                            name="alert-circle-outline"
                            size={17}
                            color="#dc5050"
                        />
                        <Text style={styles.errorText}>
                            {error}
                        </Text>
                    </View>
                )}

                {/* 검색 버튼 */}
                <Pressable
                    style={({ pressed }) => [
                        styles.searchButton,
                        pressed && styles.pressed,
                    ]}
                    onPress={handleSearch}
                >
                    <Ionicons
                        name="search"
                        size={20}
                        color={WHITE}
                    />
                    <Text style={styles.searchButtonText}>
                        경로 검색
                    </Text>
                </Pressable>

                {/* 검색 결과 영역 - API 연동 전 */}
                {searched ? (
                    <View style={styles.resultCard}>
                        <View style={styles.resultHeader}>
                            <Ionicons
                                name="train-outline"
                                size={21}
                                color={NAVY}
                            />

                            <Text style={styles.resultTitle}>
                                경로 검색
                            </Text>
                        </View>

                        <Text style={styles.resultRoute}>
                            {departure.trim()} → {destination.trim()}
                        </Text>

                        <View style={styles.resultDivider} />

                        <Text style={styles.resultInfo}>
                            경로 탐색 API 연동 후 이동 시간,
                            환승 횟수, 요금 및 경로별 비교
                            결과가 이 영역에 표시됩니다.
                        </Text>
                    </View>
                ) : (
                    <View style={styles.emptyState}>
                        <View style={styles.emptyIcon}>
                            <Ionicons
                                name="subway-outline"
                                size={30}
                                color={SECONDARY}
                            />
                        </View>

                        <Text style={styles.emptyTitle}>
                            경로를 검색해 보세요
                        </Text>

                        <Text style={styles.emptyDescription}>
                            출발역과 도착역을 입력하면
                            경로 탐색 결과를 확인할 수 있어요.
                        </Text>
                    </View>
                )}
            </ScrollView>
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
        paddingTop: 28,
        paddingBottom: 40,
    },

    intro: {
        marginBottom: 24,
    },

    title: {
        fontSize: 24,
        fontWeight: '800',
        color: NAVY,
        marginBottom: 9,
    },

    description: {
        fontSize: 14,
        color: SECONDARY,
        lineHeight: 21,
    },

    stationCard: {
        backgroundColor: WHITE,
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingVertical: 10,
        position: 'relative',
        borderWidth: 1,
        borderColor: BORDER,
    },

    stationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 76,
    },

    pointColumn: {
        width: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },

    startPoint: {
        width: 13,
        height: 13,
        borderRadius: 7,
        borderWidth: 3,
        borderColor: MINT,
        backgroundColor: WHITE,
    },

    endPoint: {
        width: 13,
        height: 13,
        borderRadius: 7,
        backgroundColor: NAVY,
    },

    stationContent: {
        flex: 1,
        marginLeft: 9,
        marginRight: 38,
    },

    stationLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: SECONDARY,
        marginBottom: 5,
    },

    stationInput: {
        fontSize: 16,
        fontWeight: '600',
        color: NAVY,
        paddingVertical: 5,
        outlineStyle: 'none',
    } as any,

    stationDivider: {
        height: 1,
        backgroundColor: BORDER,
        marginLeft: 42,
    },

    swapButton: {
        position: 'absolute',
        right: 17,
        top: '50%',
        marginTop: -19,
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: BACKGROUND,
        borderWidth: 1,
        borderColor: BORDER,
        justifyContent: 'center',
        alignItems: 'center',
    },

    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 13,
        gap: 6,
    },

    errorText: {
        fontSize: 13,
        color: '#dc5050',
    },

    searchButton: {
        height: 54,
        borderRadius: 14,
        backgroundColor: NAVY,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 9,
        marginTop: 20,
    },

    searchButtonText: {
        fontSize: 16,
        fontWeight: '700',
        color: WHITE,
    },

    resultCard: {
        marginTop: 26,
        backgroundColor: WHITE,
        borderRadius: 18,
        padding: 20,
        borderWidth: 1,
        borderColor: BORDER,
    },

    resultHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        marginBottom: 14,
    },

    resultTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: NAVY,
    },

    resultRoute: {
        fontSize: 16,
        fontWeight: '700',
        color: NAVY,
    },

    resultDivider: {
        height: 1,
        backgroundColor: BORDER,
        marginVertical: 17,
    },

    resultInfo: {
        fontSize: 13,
        lineHeight: 22,
        color: SECONDARY,
    },

    emptyState: {
        alignItems: 'center',
        marginTop: 65,
    },

    emptyIcon: {
        width: 70,
        height: 70,
        borderRadius: 35,
        backgroundColor: WHITE,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 17,
    },

    emptyTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: NAVY,
        marginBottom: 9,
    },

    emptyDescription: {
        fontSize: 13,
        lineHeight: 21,
        color: SECONDARY,
        textAlign: 'center',
        maxWidth: 260,
    },

    pressed: {
        opacity: 0.75,
    },
});
