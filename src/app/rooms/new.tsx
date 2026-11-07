import { useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { CalendarModal, TimeWheelModal } from '@/components/rooms/appointment-picker';
import { formatAppointmentParam } from '@/constants/home-mock';
import { createRoom, ROOM_NAME_MAX, roomNameLength } from '@/services/room';
import { RoomError } from '@/types/room';

const NAVY = '#0f1c3f';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const WHITE = '#ffffff';
const BG = '#f3f5f8';
const RED = '#e5484d';

/**
 * 새 약속방 만들기 (#42, 상세설계서 그림 26 ❸·그림 27 ❺, API 명세 7.1 POST /rooms)
 *
 * 기존 약속방 화면의 '방 만들기' 폼을 옮겼습니다. 정원은 명세상 4명 고정이라 인원 선택은 뺐습니다.
 * mock 으로 방을 만들고(만든 사람이 방장) 바로 약속방으로 들어갑니다. 목록에도 반영됩니다.
 */
export default function NewRoomScreen() {
    const insets = useSafeAreaInsets();
    const [roomName, setRoomName] = useState('');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [timeOpen, setTimeOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const [saving, setSaving] = useState(false);

    const goBack = () => (router.canGoBack() ? router.back() : router.replace('/rooms'));

    const nameLength = roomNameLength(roomName);

    const submit = async () => {
        if (nameLength === 0) return setNotice('약속방 이름을 입력해 주세요.');
        if (nameLength > ROOM_NAME_MAX) return setNotice(`약속방 이름은 ${ROOM_NAME_MAX}자까지 쓸 수 있어요.`);
        // 약속 시각은 선택 (명세: 시각 없는 방도 있음). 날짜·시간 중 하나만 고르면 안내합니다.
        if (!!date !== !!time) return setNotice('약속 날짜와 시간을 모두 고르거나, 둘 다 비워 두세요.');

        let at: Date | null = null;
        if (date && time) {
            const [y, m, d] = date.split('-').map(Number);
            const [h, min] = time.split(':').map(Number);
            at = new Date(y, m - 1, d, h, min);
            if (at.getTime() < Date.now()) return setNotice('현재 이후의 약속 날짜와 시간을 선택해 주세요.');
        }

        setNotice('');
        setSaving(true);
        try {
            const room = await createRoom({ name: roomName, appointmentAt: at ? at.toISOString() : null });
            // 만든 방으로 들어갑니다. 뒤로 가면 목록으로 돌아갑니다.
            router.replace({
                pathname: '/rooms/[roomId]',
                params: {
                    roomId: room.id,
                    roomName: room.name,
                    appointmentAt: at ? formatAppointmentParam(at) : '',
                    maxMembers: String(room.maxMembers),
                },
            });
        } catch (error) {
            setNotice(error instanceof RoomError ? error.message : '약속방을 만들지 못했어요. 다시 시도해 주세요.');
            setSaving(false);
        }
    };

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
                        style={styles.input}
                        placeholder="예: 금요일 저녁"
                        placeholderTextColor="#a1a8b8"
                        value={roomName}
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

const styles = StyleSheet.create({
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