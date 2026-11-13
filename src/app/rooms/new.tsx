import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { CalendarModal, TimeWheelModal } from '@/components/rooms/appointment-picker';
import { formatAppointmentParam, formatMonthDay, formatTime } from '@/constants/home-mock';
import { ApiError, isAuthError } from '@/services/api/errors';
import { createRoom, ROOM_NAME_MAX, roomNameLength, validateRoomName } from '@/services/room';
import { RoomError, type CreatedRoom } from '@/types/room';

const NAVY = '#0f1c3f';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const WHITE = '#ffffff';
const BG = '#f3f5f8';
const RED = '#e5484d';
const MINT = '#2bcf9a';
const MINT_DEEP = '#12a77a';
const MINT_SOFT = '#e8f8f1';

/**
 * 새 약속방 만들기 (#42·#43, 상세설계서 그림 26 ❸·그림 27 ❺, API 명세 7.1 POST /rooms)
 *
 * 방 이름(1~30자)과 선택 사항인 약속 시각으로 방을 만들어요. 서버·mock 모두 정원은 4명이에요.
 * 만든 사람이 방장(OWNER)이고 처음 인원은 1명입니다. 결과는 약속방 목록에도 반영됩니다.
 * 생성 후에는 초대 코드를 확인·복사하고 약속방으로 들어갑니다(초대 코드는 방장에게만, 그림 28 ❻).
 * 테스트용: /rooms/new?mock=error → 첫 생성 실패
 */
export default function NewRoomScreen() {
    const insets = useSafeAreaInsets();
    const { mock } = useLocalSearchParams<{ mock?: string }>();
    const [failNext, setFailNext] = useState(mock === 'error');
    const [created, setCreated] = useState<{ room: CreatedRoom; at: Date | null } | null>(null);
    const [roomName, setRoomName] = useState('');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [timeOpen, setTimeOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const [saving, setSaving] = useState(false);
    const submitting = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const goBack = () => (router.canGoBack() ? router.back() : router.replace('/rooms'));

    const nameLength = roomNameLength(roomName);

    const submit = async () => {
        if (submitting.current) return;
        const nameError = validateRoomName(roomName);
        if (nameError) return setNotice(nameError);
        // 약속 시각은 선택 (명세: 시각 없는 방도 있음). 날짜·시간 중 하나만 고르면 안내합니다.
        if (!!date !== !!time) return setNotice('약속 날짜와 시간을 모두 고르거나, 둘 다 비워 두세요.');

        let at: Date | null = null;
        if (date && time) {
            const [y, m, d] = date.split('-').map(Number);
            const [h, min] = time.split(':').map(Number);
            at = new Date(y, m - 1, d, h, min);
            if (at.getTime() < Date.now()) return setNotice('현재 이후의 약속 날짜와 시간을 선택해 주세요.');
        }

        submitting.current = true;
        let succeeded = false;
        setNotice('');
        setSaving(true);
        try {
            const fail = failNext;
            setFailNext(false); // 다시 시도하면 성공하도록
            const room = await createRoom({ name: roomName, appointmentAt: at ? at.toISOString() : null }, fail);
            succeeded = true;
            if (mounted.current) setCreated({ room, at: room.appointmentAt ? new Date(room.appointmentAt) : null });
        } catch (error) {
            if (!mounted.current || error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            // 실패해도 입력값은 그대로 둡니다.
            setNotice(error instanceof RoomError ? error.message : '약속방을 만들지 못했어요. 다시 시도해 주세요.');
        } finally {
            if (!succeeded) submitting.current = false;
            if (mounted.current) setSaving(false);
        }
    };

    const clearAppointment = () => {
        setDate('');
        setTime('');
        setNotice('');
    };

    if (created) {
        return <CreatedView room={created.room} at={created.at} topInset={insets.top} bottomInset={insets.bottom} />;
    }

    return (
        <View style={styles.root}>
            <StatusBar style="dark" />
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <Pressable onPress={goBack} style={styles.backButton} accessibilityLabel="뒤로 가기">
                    <Ionicons name="chevron-back" size={25} color={NAVY} />
                </Pressable>
                <Text style={styles.headerText}>새 약속방</Text>
                <View style={styles.backButton} />
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                <View style={styles.formCard}>
                    <View style={styles.labelRow}>
                        <Text style={styles.label}>약속방 이름</Text>
                        <Text style={[styles.counter, nameLength > ROOM_NAME_MAX && { color: RED }]}>
                            {nameLength}/{ROOM_NAME_MAX}
                        </Text>
                    </View>
                    <TextInput
                        style={[styles.input, nameLength > ROOM_NAME_MAX && styles.inputError]}
                        placeholder="예: 금요일 저녁"
                        placeholderTextColor="#a1a8b8"
                        value={roomName}
                        editable={!saving}
                        onChangeText={value => {
                            setRoomName(value);
                            setNotice('');
                        }}
                    />
                    <Text style={styles.label}>
                        약속 날짜 <Text style={styles.optional}>(선택)</Text>
                    </Text>
                    <Pressable style={styles.selectBox} onPress={() => setCalendarOpen(true)}>
                        <Ionicons name="calendar-outline" size={21} color={NAVY} />
                        <Text style={[styles.selectText, !date && styles.placeholder]}>{date || '달력에서 날짜 선택'}</Text>
                        <Ionicons name="chevron-down" size={17} color={SECONDARY} />
                    </Pressable>
                    <Text style={styles.label}>
                        약속 시간 <Text style={styles.optional}>(선택)</Text>
                    </Text>
                    <Pressable style={styles.selectBox} onPress={() => setTimeOpen(true)}>
                        <Ionicons name="time-outline" size={21} color={NAVY} />
                        <Text style={[styles.selectText, !time && styles.placeholder]}>{time || '스크롤하여 시간 선택'}</Text>
                        <Ionicons name="chevron-down" size={17} color={SECONDARY} />
                    </Pressable>
                    {date || time ? (
                        <Pressable onPress={clearAppointment} style={styles.clearLink} accessibilityRole="button">
                            <Ionicons name="close-circle" size={15} color={SECONDARY} />
                            <Text style={styles.clearText}>약속 시각 지우기</Text>
                        </Pressable>
                    ) : (
                        <Text style={styles.hint}>약속 시각은 나중에 방장이 정해도 돼요.</Text>
                    )}

                    <View style={styles.infoRow}>
                        <Ionicons name="people-outline" size={17} color={SECONDARY} />
                        <Text style={styles.infoText}>최대 4명까지 함께할 수 있고, 만든 사람이 방장이 돼요.</Text>
                    </View>

                    {!!notice && <Text style={styles.notice}>{notice}</Text>}

                    <Pressable
                        style={({ pressed }) => [styles.primaryButton, saving && styles.disabled, pressed && styles.pressed]}
                        onPress={submit}
                        disabled={saving}
                        accessibilityRole="button"
                    >
                        {saving ? <ActivityIndicator color={WHITE} /> : <Text style={styles.primaryText}>약속방 만들기</Text>}
                    </Pressable>
                </View>
            </ScrollView>

            <CalendarModal
                visible={calendarOpen}
                value={date}
                onClose={() => setCalendarOpen(false)}
                onConfirm={value => {
                    setDate(value);
                    setNotice('');
                }}
            />
            <TimeWheelModal
                visible={timeOpen}
                value={time || '19:00'}
                onClose={() => setTimeOpen(false)}
                onConfirm={value => {
                    setTime(value);
                    setNotice('');
                }}
            />
        </View>
    );
}

/** 생성 완료: 초대 코드 확인·복사 → 약속방으로 */
function CreatedView({
                         room,
                         at,
                         topInset,
                         bottomInset,
                     }: {
    room: CreatedRoom;
    at: Date | null;
    topInset: number;
    bottomInset: number;
}) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        await Clipboard.setStringAsync(room.roomCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };

    const share = () => {
        Share.share({ message: `LinkRo 약속방 "${room.name}"에 초대할게요. 초대 코드: ${room.roomCode}` }).catch(() => undefined);
    };

    const enter = () => {
        // 목록 → 새 약속방 자리를 약속방으로 바꿉니다. 뒤로 가면 목록으로 돌아갑니다.
        router.replace({
            pathname: '/rooms/[roomId]',
            params: {
                roomId: room.id,
                roomName: room.name,
                appointmentAt: at ? formatAppointmentParam(at) : '',
                maxMembers: String(room.maxMembers),
            },
        });
    };

    return (
        <View style={[styles.root, { paddingTop: topInset + 28, paddingBottom: bottomInset + 20 }]}>
            <StatusBar style="dark" />
            <View style={styles.doneContent}>
                <View style={styles.doneIcon}>
                    <Ionicons name="checkmark" size={30} color={WHITE} />
                </View>
                <Text style={styles.doneTitle}>약속방을 만들었어요</Text>
                <Text style={styles.doneCaption}>초대 코드를 보내 친구들을 불러 보세요</Text>

                <View style={styles.roomCard}>
                    <Text style={styles.roomName} numberOfLines={1}>
                        {room.name}
                    </Text>
                    <Text style={styles.roomMeta}>
                        {at ? `${formatMonthDay(at)} ${formatTime(at)}` : '약속 시각 미정'} · {room.memberCount}/{room.maxMembers}명 ·
                        방장
                    </Text>
                </View>

                <Text style={styles.codeLabel}>초대 코드</Text>
                <Pressable
                    style={({ pressed }) => [styles.codeBox, pressed && styles.pressed]}
                    onPress={copy}
                    accessibilityRole="button"
                    accessibilityLabel={`초대 코드 ${room.roomCode.split('').join(' ')}, 눌러서 복사`}
                >
                    <Text style={styles.codeText}>{room.roomCode}</Text>
                    <View style={styles.copyChip}>
                        <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={MINT_DEEP} />
                        <Text style={styles.copyText}>{copied ? '복사됨' : '복사'}</Text>
                    </View>
                </Pressable>
                <Text style={styles.codeHint}>초대 코드는 방장에게만 보여요. 최대 4명까지 들어올 수 있어요.</Text>

                <Pressable style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]} onPress={share}>
                    <Ionicons name="share-outline" size={18} color={NAVY} />
                    <Text style={styles.shareText}>친구에게 공유</Text>
                </Pressable>
            </View>

            <Pressable
                style={({ pressed }) => [styles.primaryButton, styles.enterButton, pressed && styles.pressed]}
                onPress={enter}
                accessibilityRole="button"
            >
                <Text style={styles.primaryText}>약속방으로 들어가기</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    doneContent: { flex: 1, alignItems: 'center', paddingHorizontal: 20 },
    doneIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: MINT },
    doneTitle: { marginTop: 16, color: NAVY, fontSize: 22, fontWeight: '900' },
    doneCaption: { marginTop: 6, color: SECONDARY, fontSize: 13.5, fontWeight: '600' },
    roomCard: { alignSelf: 'stretch', marginTop: 24, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: WHITE },
    roomName: { color: NAVY, fontSize: 17, fontWeight: '800' },
    roomMeta: { marginTop: 5, color: SECONDARY, fontSize: 13, fontWeight: '600' },
    codeLabel: { alignSelf: 'flex-start', marginTop: 22, marginBottom: 8, color: NAVY, fontSize: 13, fontWeight: '800' },
    codeBox: { alignSelf: 'stretch', height: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, borderWidth: 1.5, borderColor: MINT, backgroundColor: MINT_SOFT },
    codeText: { color: NAVY, fontSize: 26, fontWeight: '900', letterSpacing: 6 },
    copyChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: WHITE },
    copyText: { color: MINT_DEEP, fontSize: 12.5, fontWeight: '800' },
    codeHint: { alignSelf: 'flex-start', marginTop: 8, color: SECONDARY, fontSize: 12, fontWeight: '600' },
    shareButton: { alignSelf: 'stretch', marginTop: 16, height: 48, borderRadius: 13, borderWidth: 1, borderColor: BORDER, backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    shareText: { color: NAVY, fontSize: 14.5, fontWeight: '800' },
    enterButton: { marginHorizontal: 20 },
    root: { flex: 1, backgroundColor: BG },
    header: { backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 15, borderBottomWidth: 1, borderColor: BORDER },
    backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerText: { color: NAVY, fontSize: 18, fontWeight: '800' },
    content: { padding: 20, paddingBottom: 40 },
    formCard: { backgroundColor: WHITE, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 18 },
    label: { fontSize: 13, fontWeight: '700', color: NAVY, marginBottom: 9 },
    labelRow: { flexDirection: 'row', justifyContent: 'space-between' },
    counter: { fontSize: 12, fontWeight: '600', color: '#a1a8b8' },
    optional: { fontSize: 12, fontWeight: '600', color: '#a1a8b8' },
    inputError: { borderColor: RED },
    clearLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: -8, marginBottom: 16 },
    clearText: { color: SECONDARY, fontSize: 12.5, fontWeight: '700' },
    hint: { color: '#a1a8b8', fontSize: 12, fontWeight: '600', marginTop: -8, marginBottom: 16 },
    input: { backgroundColor: '#f8f9fb', borderRadius: 11, borderWidth: 1, borderColor: BORDER, minHeight: 48, paddingHorizontal: 13, color: NAVY, fontSize: 14, marginBottom: 17 },
    selectBox: { borderRadius: 11, borderWidth: 1, borderColor: BORDER, backgroundColor: '#f8f9fb', height: 49, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, marginBottom: 17 },
    selectText: { flex: 1, color: NAVY, fontSize: 14, fontWeight: '600' },
    placeholder: { color: '#a1a8b8', fontWeight: '400' },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 16 },
    infoText: { flex: 1, color: SECONDARY, fontSize: 12.5, fontWeight: '600' },
    notice: { color: RED, fontSize: 12.5, fontWeight: '600', marginBottom: 12 },
    primaryButton: { backgroundColor: NAVY, height: 53, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: WHITE, fontSize: 15, fontWeight: '800' },
    disabled: { opacity: 0.6 },
    pressed: { opacity: 0.72 },
});