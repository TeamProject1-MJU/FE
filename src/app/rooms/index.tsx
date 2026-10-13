import { useState } from 'react';
import { router } from 'expo-router';
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
import { CalendarModal, TimeWheelModal } from '@/components/rooms/appointment-picker';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const WHITE = '#ffffff';
const BG = '#f3f5f8';

type FormMode = 'create' | 'join';

export default function RoomsScreen() {
    const insets = useSafeAreaInsets();
    const [mode, setMode] = useState<FormMode>('create');
    const [roomName, setRoomName] = useState('');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [maxMembers, setMaxMembers] = useState<2 | 3 | 4>(4);
    const [inviteCode, setInviteCode] = useState('');
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [timeOpen, setTimeOpen] = useState(false);
    const [notice, setNotice] = useState('');

    const goBack = () => router.canGoBack() ? router.back() : router.replace('/home');

    const createPreview = () => {
        if (!roomName.trim()) return setNotice('약속방 이름을 입력해 주세요.');
        if (!date || !time) return setNotice('달력과 시간 선택기로 약속 날짜·시간을 설정해 주세요.');
        const [y, m, d] = date.split('-').map(Number);
        const [h, min] = time.split(':').map(Number);
        if (new Date(y, m - 1, d, h, min).getTime() < Date.now()) {
            return setNotice('현재 이후의 약속 날짜와 시간을 선택해 주세요.');
        }
        setNotice('');
        // API 호출 전 미리보기입니다. 실제 방을 만들거나 저장하지 않습니다.
        router.push({
            pathname: '/rooms/[roomId]',
            params: {
                roomId: 'preview',
                roomName: roomName.trim(),
                appointmentAt: `${date} ${time}`,
                maxMembers: String(maxMembers),
            },
        });
    };

    const checkJoinCode = () => {
        if (!/^[A-Z0-9]{6}$/.test(inviteCode.trim().toUpperCase())) {
            setNotice('영문 대문자와 숫자 6자리의 초대 코드를 입력해 주세요.');
            return;
        }
        setNotice('초대 코드 형식 확인 완료. 실제 방 참여는 POST /rooms/join 연동 후 가능합니다.');
    };

    return (
        <View style={styles.root}>
            <StatusBar style="dark" />
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <Pressable onPress={goBack} style={styles.backButton}>
                    <Ionicons name="chevron-back" size={25} color={NAVY} />
                </Pressable>
                <Text style={styles.headerText}>약속방</Text>
                <View style={styles.backButton} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
                <View style={styles.heading}>
                    <Text style={styles.title}>함께 만나는 길을{'\n'}더 쉽게 찾아보세요</Text>
                    <Text style={styles.caption}>약속방에서 출발역을 공유하고 중간역을 추천받아 보세요.</Text>
                </View>

                <Text style={styles.sectionTitle}>내 약속방</Text>
                <View style={styles.emptyCard}>
                    <Ionicons name="people-circle-outline" size={46} color={NAVY} />
                    <Text style={styles.emptyTitle}>연결된 약속방이 없어요</Text>
                    <Text style={styles.caption}>서버 목록 조회 전 UI 미리보기입니다.</Text>
                </View>

                <Text style={styles.sectionTitle}>약속방 시작하기</Text>
                <View style={styles.segment}>
                    <Pressable style={[styles.segmentButton, mode === 'create' && styles.segmentSelected]} onPress={() => { setMode('create'); setNotice(''); }}>
                        <Ionicons name="add-circle-outline" size={18} color={NAVY} />
                        <Text style={styles.segmentText}>방 만들기</Text>
                    </Pressable>
                    <Pressable style={[styles.segmentButton, mode === 'join' && styles.segmentSelected]} onPress={() => { setMode('join'); setNotice(''); }}>
                        <Ionicons name="enter-outline" size={18} color={NAVY} />
                        <Text style={styles.segmentText}>코드로 참여</Text>
                    </Pressable>
                </View>

                {mode === 'create' ? (
                    <View style={styles.formCard}>
                        <Text style={styles.formTitle}>새로운 약속방</Text>
                        <Text style={styles.label}>약속방 이름</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="예: 금요일 저녁"
                            placeholderTextColor="#a1a8b8"
                            value={roomName}
                            maxLength={40}
                            onChangeText={(value) => { setRoomName(value); setNotice(''); }}
                        />
                        <Text style={styles.label}>약속 날짜</Text>
                        <Pressable style={styles.selectBox} onPress={() => setCalendarOpen(true)}>
                            <Ionicons name="calendar-outline" size={21} color={NAVY} />
                            <Text style={[styles.selectText, !date && styles.placeholder]}>{date || '달력에서 날짜 선택'}</Text>
                            <Ionicons name="chevron-down" size={17} color={SECONDARY} />
                        </Pressable>
                        <Text style={styles.label}>약속 시간</Text>
                        <Pressable style={styles.selectBox} onPress={() => setTimeOpen(true)}>
                            <Ionicons name="time-outline" size={21} color={NAVY} />
                            <Text style={[styles.selectText, !time && styles.placeholder]}>{time || '스크롤하여 시간 선택'}</Text>
                            <Ionicons name="chevron-down" size={17} color={SECONDARY} />
                        </Pressable>
                        <Text style={styles.label}>최대 참여 인원</Text>
                        <View style={styles.options}>
                            {([2, 3, 4] as const).map(count => (
                                <Pressable key={count} style={[styles.option, maxMembers === count && styles.optionSelected]} onPress={() => setMaxMembers(count)}>
                                    <Text style={[styles.optionText, maxMembers === count && styles.optionSelectedText]}>{count}명</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Pressable style={styles.primaryButton} onPress={createPreview}>
                            <Text style={styles.primaryText}>약속방 내부 UI 미리보기</Text>
                            <Ionicons name="arrow-forward" size={19} color={WHITE} />
                        </Pressable>
                        <Text style={styles.smallNote}>실제 방 생성 및 초대 코드 발급은 API 연동 후 가능합니다.</Text>
                    </View>
                ) : (
                    <View style={styles.formCard}>
                        <Text style={styles.formTitle}>초대 코드로 참여</Text>
                        <Text style={styles.caption}>방장에게 받은 6자리 코드를 입력해 주세요.</Text>
                        <Text style={[styles.label, { marginTop: 22 }]}>초대 코드</Text>
                        <TextInput
                            style={[styles.input, styles.codeInput]}
                            placeholder="A3K9PZ"
                            placeholderTextColor="#a1a8b8"
                            autoCapitalize="characters"
                            maxLength={6}
                            value={inviteCode}
                            onChangeText={value => { setInviteCode(value.toUpperCase()); setNotice(''); }}
                        />
                        <Pressable style={styles.primaryButton} onPress={checkJoinCode}>
                            <Text style={styles.primaryText}>초대 코드 확인</Text>
                        </Pressable>
                        <Text style={styles.smallNote}>입력 확인만 가능합니다. 참여 성공 화면을 임의로 표시하지 않습니다.</Text>
                    </View>
                )}
                {!!notice && <View style={styles.notice}><Ionicons name="information-circle-outline" size={19} color={NAVY} /><Text style={styles.noticeText}>{notice}</Text></View>}
            </ScrollView>

            <CalendarModal
                visible={calendarOpen}
                value={date}
                onClose={() => setCalendarOpen(false)}
                onConfirm={value => { setDate(value); setNotice(''); }}
            />
            <TimeWheelModal
                visible={timeOpen}
                value={time || '19:00'}
                onClose={() => setTimeOpen(false)}
                onConfirm={value => { setTime(value); setNotice(''); }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },
    header: { backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 15, borderBottomWidth: 1, borderColor: BORDER },
    backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerText: { color: NAVY, fontSize: 18, fontWeight: '800' },
    content: { padding: 20, paddingBottom: 40 },
    heading: { marginBottom: 27 },
    title: { color: NAVY, fontSize: 24, lineHeight: 33, fontWeight: '800', marginBottom: 10 },
    caption: { color: SECONDARY, fontSize: 13, lineHeight: 21 },
    sectionTitle: { color: NAVY, fontSize: 17, fontWeight: '700', marginBottom: 12 },
    emptyCard: { backgroundColor: WHITE, borderRadius: 18, borderWidth: 1, borderColor: BORDER, alignItems: 'center', padding: 25, marginBottom: 28, gap: 9 },
    emptyTitle: { color: NAVY, fontSize: 15, fontWeight: '700', marginTop: 5 },
    segment: { flexDirection: 'row', gap: 9, marginBottom: 13 },
    segmentButton: { flex: 1, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 12, height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
    segmentSelected: { backgroundColor: '#eafbf5', borderColor: MINT },
    segmentText: { fontSize: 13, fontWeight: '700', color: NAVY },
    formCard: { backgroundColor: WHITE, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 18 },
    formTitle: { fontSize: 17, fontWeight: '800', color: NAVY, marginBottom: 20 },
    label: { fontSize: 13, fontWeight: '700', color: NAVY, marginBottom: 9 },
    input: { backgroundColor: '#f8f9fb', borderRadius: 11, borderWidth: 1, borderColor: BORDER, minHeight: 48, paddingHorizontal: 13, color: NAVY, fontSize: 14, marginBottom: 17 },
    selectBox: { borderRadius: 11, borderWidth: 1, borderColor: BORDER, backgroundColor: '#f8f9fb', height: 49, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, marginBottom: 17 },
    selectText: { flex: 1, color: NAVY, fontSize: 14, fontWeight: '600' },
    placeholder: { color: '#a1a8b8', fontWeight: '400' },
    options: { flexDirection: 'row', gap: 9, marginBottom: 20 },
    option: { flex: 1, borderWidth: 1, borderColor: BORDER, backgroundColor: '#f8f9fb', height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    optionSelected: { borderColor: MINT, backgroundColor: '#eafbf5' },
    optionText: { color: SECONDARY, fontWeight: '700' },
    optionSelectedText: { color: NAVY },
    primaryButton: { backgroundColor: NAVY, height: 53, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
    primaryText: { color: WHITE, fontSize: 14, fontWeight: '800' },
    codeInput: { textAlign: 'center', fontSize: 19, letterSpacing: 4, fontWeight: '800' },
    smallNote: { color: SECONDARY, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
    notice: { backgroundColor: '#e9edf5', borderRadius: 12, padding: 13, marginTop: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
    noticeText: { color: NAVY, fontSize: 12, lineHeight: 19, flex: 1 },
});
