import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
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
const PURPLE = '#6a5ae0';
const WHITE = '#ffffff';
const BG = '#f3f5f8';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';

type CriterionIcon = 'time-outline' | 'wallet-outline' | 'map-outline';
type Criterion = {
    key: 'TIME' | 'FARE' | 'DISTANCE';
    label: string;
    icon: CriterionIcon;
    sampleStation: string;
    caption: string;
};

const EXAMPLES: Criterion[] = [
    { key: 'TIME', label: '시간 기준', icon: 'time-outline', sampleStation: '사당역', caption: '이동시간 및 시간 차이' },
    { key: 'FARE', label: '요금 기준', icon: 'wallet-outline', sampleStation: '서울역', caption: '참여자별 이동 요금' },
    { key: 'DISTANCE', label: '거리 기준', icon: 'map-outline', sampleStation: '왕십리역', caption: '참여자별 이동 거리' },
];

export default function RoomRecommendationsScreen() {
    const insets = useSafeAreaInsets();
    const { roomId, roomName, maxMembers } = useLocalSearchParams<{
        roomId: string;
        roomName?: string;
        maxMembers?: string;
    }>();

    const [conditionText, setConditionText] = useState('');
    const [showExamples, setShowExamples] = useState(false);
    const [notice, setNotice] = useState('');

    const max = Number(maxMembers);
    const exampleMembers = [
        { name: '나', station: '서울역' },
        { name: '민지', station: '강남역' },
        ...(max >= 3 || !maxMembers ? [{ name: '준호', station: '왕십리역' }] : []),
    ];

    const goBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace({
                pathname: '/rooms/[roomId]',
                params: { roomId: String(roomId) },
            });
        }
    };

    const previewRecommendation = () => {
        // 서버 요청 X: 결과 카드의 형태만 보여줍니다.
        setShowExamples(true);
        setNotice('예시 UI입니다. 실제 추천역·이동 수치는 API 연동 후 표시됩니다.');
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Pressable onPress={goBack} style={styles.backButton}>
                    <Ionicons name="chevron-back" size={24} color={NAVY} />
                </Pressable>
                <Text style={styles.headerTitle}>중간역 추천</Text>
                <View style={styles.backButton} />
            </View>

            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.intro}>
                    <View style={styles.aiChip}>
                        <Ionicons name="sparkles" size={14} color={PURPLE} />
                        <Text style={styles.aiChipText}>LinkRo 중간역 추천</Text>
                    </View>
                    <Text style={styles.title}>우리 모두에게 좋은{ '\n' }중간역을 찾아볼까요?</Text>
                    <Text style={styles.subtitle}>
                        참여자들의 출발역을 기준으로 시간·요금·거리별 최적역을 추천하는 화면입니다.
                    </Text>
                </View>

                <View style={styles.card}>
                    <View style={styles.rowBetween}>
                        <Text style={styles.sectionTitle}>참여자 출발역</Text>
                        <Text style={styles.exampleLabel}>예시 데이터</Text>
                    </View>
                    <Text style={styles.roomName}>{roomName || '약속방 미리보기'}</Text>
                    {exampleMembers.map((member, index) => (
                        <View key={member.name} style={[styles.memberRow, index > 0 && styles.memberDivider]}>
                            <View style={styles.avatar}>
                                <Ionicons name="person-outline" size={17} color={NAVY} />
                            </View>
                            <Text style={styles.memberName}>{member.name}</Text>
                            <View style={styles.stationTag}>
                                <Ionicons name="location-outline" size={14} color={NAVY} />
                                <Text style={styles.stationName}>{member.station}</Text>
                            </View>
                        </View>
                    ))}
                    <Text style={styles.helper}>
                        실제 참여자와 출발역은 추후 방 상세 조회 API 데이터로 교체합니다.
                    </Text>
                </View>

                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>AI 추천 조건</Text>
                    <Text style={styles.helper}>
                        선택 사항이에요. 원하는 조건을 자연어로 적을 수 있어요.
                    </Text>
                    <TextInput
                        multiline
                        style={styles.conditionInput}
                        value={conditionText}
                        onChangeText={(value) => {
                            setConditionText(value);
                            setShowExamples(false);
                            setNotice('');
                        }}
                        placeholder="예: 모두 40분 이내이고 환승은 최대 1번인 곳"
                        placeholderTextColor="#a1a8b8"
                        textAlignVertical="top"
                    />
                    <Pressable style={styles.primaryButton} onPress={previewRecommendation}>
                        <Ionicons name="sparkles" color={WHITE} size={19} />
                        <Text style={styles.primaryText}>추천 결과 UI 미리보기</Text>
                    </Pressable>
                    <Text style={styles.helperCenter}>
                        아직 실제 추천 계산이나 AI 조건 분석은 수행하지 않습니다.
                    </Text>
                </View>

                {showExamples && (
                    <View>
                        <View style={styles.resultsHeading}>
                            <Text style={styles.resultsTitle}>기준별 추천 결과</Text>
                            <Text style={styles.exampleLabel}>화면 예시</Text>
                        </View>
                        {EXAMPLES.map((result) => (
                            <View key={result.key} style={styles.resultCard}>
                                <View style={styles.resultHeading}>
                                    <View style={styles.resultIcon}>
                                        <Ionicons name={result.icon} color={NAVY} size={21} />
                                    </View>
                                    <Text style={styles.resultTitle}>{result.label}</Text>
                                    <Text style={styles.exampleLabel}>예시</Text>
                                </View>
                                <Text style={styles.exampleStation}>{result.sampleStation}</Text>
                                <Text style={styles.resultDesc}>
                                    실제 API 연동 후 {result.caption}, 주변 대안역, 설명이 표시됩니다.
                                </Text>
                                <Pressable
                                    style={styles.outlineButton}
                                    onPress={() => setNotice(
                                        `${result.sampleStation}은 예시 역입니다. 실제 후보 제안은 추천 API 및 후보 API 연동 후 가능합니다.`,
                                    )}
                                >
                                    <Ionicons name="add-circle-outline" size={18} color={NAVY} />
                                    <Text style={styles.outlineButtonText}>약속역 후보로 제안하기</Text>
                                </Pressable>
                            </View>
                        ))}
                    </View>
                )}

                {!!notice && (
                    <View style={styles.notice}>
                        <Ionicons name="information-circle-outline" color={NAVY} size={18} />
                        <Text style={styles.noticeText}>{notice}</Text>
                    </View>
                )}

                <Pressable style={styles.backToRoom} onPress={goBack}>
                    <Ionicons name="arrow-back-outline" size={17} color={SECONDARY} />
                    <Text style={styles.backToRoomText}>약속방으로 돌아가기</Text>
                </Pressable>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingBottom: 14,
        backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '700', color: NAVY },
    content: { padding: 20, paddingBottom: 44 },
    intro: { marginBottom: 22 },
    aiChip: {
        flexDirection: 'row', gap: 7, alignItems: 'center', alignSelf: 'flex-start',
        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
        backgroundColor: '#f0eefd', marginBottom: 14,
    },
    aiChipText: { fontSize: 12, fontWeight: '700', color: PURPLE },
    title: { fontSize: 23, lineHeight: 33, fontWeight: '800', color: NAVY, marginBottom: 10 },
    subtitle: { fontSize: 13, lineHeight: 22, color: SECONDARY },
    card: {
        backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER,
        borderRadius: 18, padding: 18, marginBottom: 17,
    },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: NAVY, marginBottom: 12 },
    exampleLabel: { color: PURPLE, fontWeight: '700', fontSize: 11 },
    roomName: { color: SECONDARY, fontSize: 13, marginBottom: 6 },
    memberRow: { minHeight: 53, flexDirection: 'row', alignItems: 'center', gap: 10 },
    memberDivider: { borderTopWidth: 1, borderTopColor: BORDER },
    avatar: {
        width: 33, height: 33, backgroundColor: '#eafbf5', borderRadius: 17,
        alignItems: 'center', justifyContent: 'center',
    },
    memberName: { color: NAVY, fontSize: 13, fontWeight: '700', flex: 1 },
    stationTag: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 7, borderRadius: 10, backgroundColor: BG },
    stationName: { fontSize: 12, color: NAVY, fontWeight: '600' },
    helper: { fontSize: 12, color: SECONDARY, lineHeight: 19, marginBottom: 12 },
    helperCenter: { fontSize: 11, lineHeight: 18, color: SECONDARY, textAlign: 'center', marginTop: 11 },
    conditionInput: {
        minHeight: 100, borderWidth: 1, borderColor: BORDER, borderRadius: 12,
        padding: 13, marginTop: 4, marginBottom: 16, backgroundColor: '#f8f9fb',
        fontSize: 14, lineHeight: 22, color: NAVY,
    },
    primaryButton: {
        height: 51, borderRadius: 12, backgroundColor: NAVY,
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
    },
    primaryText: { fontSize: 15, fontWeight: '700', color: WHITE },
    resultsHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 9 },
    resultsTitle: { fontSize: 17, fontWeight: '800', color: NAVY },
    resultCard: { backgroundColor: WHITE, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 12 },
    resultHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    resultIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#eafbf5', alignItems: 'center', justifyContent: 'center' },
    resultTitle: { fontSize: 15, color: NAVY, fontWeight: '700', flex: 1 },
    exampleStation: { fontSize: 21, fontWeight: '800', color: NAVY, marginTop: 14, marginBottom: 8 },
    resultDesc: { fontSize: 12, lineHeight: 20, color: SECONDARY, marginBottom: 14 },
    outlineButton: {
        height: 42, borderRadius: 10, borderColor: MINT, borderWidth: 1,
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
    },
    outlineButtonText: { fontSize: 13, fontWeight: '700', color: NAVY },
    notice: { backgroundColor: '#e9edf5', padding: 14, borderRadius: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 10 },
    noticeText: { flex: 1, color: NAVY, fontSize: 12, lineHeight: 20 },
    backToRoom: { paddingVertical: 21, flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center' },
    backToRoomText: { fontSize: 13, fontWeight: '600', color: SECONDARY },
});
