import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { formatAppointmentParam } from '@/constants/home-mock';
import { getMockRoom, joinRoom } from '@/services/room';
import { RoomError } from '@/types/room';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const WHITE = '#ffffff';
const BG = '#f3f5f8';
const RED = '#e5484d';
const CODE_LENGTH = 6;

/**
 * 약속방 입장 (#42, 상세설계서 그림 27, API 명세 7.2 POST /rooms/join)
 *
 * mock 초대 코드: A3K9PZ(입장 가능), FULL44(정원 초과). 그 밖의 코드는 '코드를 다시 확인' 안내.
 */
export default function JoinRoomScreen() {
    const insets = useSafeAreaInsets();
    const inputRef = useRef<TextInput>(null);
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [joining, setJoining] = useState(false);

    const goBack = () => (router.canGoBack() ? router.back() : router.replace('/rooms'));
    const ready = code.length === CODE_LENGTH && !joining;

    const join = async () => {
        if (!ready) return;
        setJoining(true);
        setError('');
        try {
            const { roomId } = await joinRoom(code);
            const room = getMockRoom(roomId);
            router.replace({
                pathname: '/rooms/[roomId]',
                params: {
                    roomId,
                    roomName: room?.name ?? '',
                    appointmentAt: room?.appointmentAt ? formatAppointmentParam(new Date(room.appointmentAt)) : '',
                    maxMembers: String(room?.maxMembers ?? 4),
                },
            });
        } catch (caught) {
            setError(caught instanceof RoomError ? caught.message : '입장하지 못했어요. 다시 시도해 주세요.');
            setJoining(false);
        }
    };

    return (
        <View style={styles.root}>
            <StatusBar style="dark" />
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <Pressable onPress={goBack} style={styles.backButton} accessibilityLabel="뒤로 가기">
                    <Ionicons name="chevron-back" size={25} color={NAVY} />
                </Pressable>
                <Text style={styles.headerText}>약속방 입장</Text>
                <View style={styles.backButton} />
            </View>

            <View style={styles.content}>
                <View style={styles.hero}>
                    <View style={styles.heroIcon}>
                        <Ionicons name="people" size={26} color={WHITE} />
                    </View>
                    <Text style={styles.title}>친구들의 약속방에{'\n'}참여해 보세요</Text>
                    <Text style={styles.caption}>공유받은 6자리 초대 코드를 입력하면 돼요</Text>
                </View>

                {/* ❹ 초대 코드 입력 */}
                <Text style={styles.label}>초대 코드</Text>
                <View style={styles.codeRow}>
                    {Array.from({ length: CODE_LENGTH }, (_, index) => (
                        <View
                            key={index}
                            style={[
                                styles.codeBox,
                                index === code.length && styles.codeBoxActive,
                                !!error && styles.codeBoxError,
                            ]}
                        >
                            <Text style={styles.codeChar}>{code[index] ?? ''}</Text>
                        </View>
                    ))}
                    <TextInput
                        ref={inputRef}
                        style={styles.hiddenInput}
                        value={code}
                        onChangeText={value => {
                            setCode(value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, CODE_LENGTH));
                            setError('');
                        }}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={CODE_LENGTH}
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={join}
                        caretHidden
                        selectionColor="transparent"
                        accessibilityLabel="초대 코드"
                    />
                </View>
                {!!error && <Text style={styles.error}>{error}</Text>}

                <Pressable
                    style={({ pressed }) => [styles.primaryButton, !ready && styles.primaryDisabled, pressed && styles.pressed]}
                    onPress={join}
                    disabled={!ready}
                    accessibilityRole="button"
                >
                    {joining ? <ActivityIndicator color={WHITE} /> : <Text style={styles.primaryText}>입장하기</Text>}
                </Pressable>

                <View style={styles.dividerRow}>
                    <View style={styles.divider} />
                    <Text style={styles.dividerText}>또는</Text>
                    <View style={styles.divider} />
                </View>

                {/* ❺ 새 약속방 만들기 */}
                <Pressable
                    style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}
                    onPress={() => router.replace('/rooms/new')}
                    accessibilityRole="button"
                >
                    <Ionicons name="add" size={20} color={NAVY} />
                    <Text style={styles.outlineText}>새 약속방 만들기</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
    backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerText: { color: NAVY, fontSize: 18, fontWeight: '800' },
    content: { paddingHorizontal: 20, paddingTop: 16 },
    hero: { alignItems: 'center', marginBottom: 30 },
    heroIcon: { width: 58, height: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: MINT },
    title: { marginTop: 16, color: NAVY, fontSize: 22, fontWeight: '900', lineHeight: 30, textAlign: 'center' },
    caption: { marginTop: 8, color: SECONDARY, fontSize: 13, fontWeight: '600' },
    label: { color: NAVY, fontSize: 13, fontWeight: '800', marginBottom: 10 },
    codeRow: { flexDirection: 'row', gap: 8 },
    codeBox: { flex: 1, height: 52, borderRadius: 12, borderWidth: 1.5, borderColor: BORDER, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center' },
    codeBoxActive: { borderColor: NAVY },
    codeBoxError: { borderColor: RED },
    codeChar: { color: NAVY, fontSize: 20, fontWeight: '900' },
    // 6칸 위를 덮는 실제 입력창. iOS 는 opacity 0 인 뷰를 터치하지 못하므로 글자만 투명하게 둡니다.
    hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, color: 'transparent', backgroundColor: 'transparent', fontSize: 1 },
    error: { marginTop: 9, color: RED, fontSize: 12.5, fontWeight: '600' },
    primaryButton: { marginTop: 16, height: 52, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: NAVY },
    primaryDisabled: { backgroundColor: '#a5acba' },
    primaryText: { color: WHITE, fontSize: 15, fontWeight: '800' },
    dividerRow: { marginVertical: 22, flexDirection: 'row', alignItems: 'center', gap: 10 },
    divider: { flex: 1, height: 1, backgroundColor: BORDER },
    dividerText: { color: SECONDARY, fontSize: 12, fontWeight: '600' },
    outlineButton: { height: 52, borderRadius: 13, borderWidth: 1.5, borderColor: NAVY, backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    outlineText: { color: NAVY, fontSize: 15, fontWeight: '800' },
    pressed: { opacity: 0.72 },
});