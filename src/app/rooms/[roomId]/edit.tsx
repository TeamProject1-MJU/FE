import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Modal,
    Platform,
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
import { formatTime } from '@/constants/home-mock';
import {
    fetchRoomDetail,
    ROOM_NAME_MAX,
    roomNameLength,
    updateRoom,
    type UpdateRoomPatch,
} from '@/services/room';
import { ApiError, isAuthError } from '@/services/api/errors';
import { RoomError, type RoomDetail } from '@/types/room';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const MINT_DEEP = '#12a77a';
const WHITE = '#ffffff';
const BG = '#f3f5f8';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const RED = '#d6455d';
const ORANGE = '#c77a00';

const pad = (n: number) => String(n).padStart(2, '0');
const toDateValue = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 2026.11.14 (토) 19:00 */
function formatAppointment(date: Date) {
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} (${WEEKDAYS[date.getDay()]}) ${formatTime(date)}`;
}

type LoadError = 'ROOM_NOT_FOUND' | 'NOT_ROOM_MEMBER' | 'NOT_ROOM_OWNER' | 'UNKNOWN';
type MockMode = 'error' | 'busy' | 'load-error';

/**
 * 약속방 설정 수정 화면 (#46, 설계서 그림 31, 명세 7.5 PATCH /rooms/{roomId})
 *
 * - 방장(OWNER)만 진입할 수 있어요. 멤버는 권한 없음 안내를 보여요.
 * - 바꾼 필드만 보내고, 바꾸지 않은 필드는 생략해 그대로 유지해요.
 * - 약속 시각은 '해제'(null 전송)와 '변경하지 않음'(생략)을 구분해요.
 * - 저장해도 추천을 새로 만들지 않아요. 기존 추천·후보·확정 약속역은 그대로예요.
 *
 * 테스트용 (mock):
 *   /rooms/room-4/edit?mock=error       → 첫 저장 실패(NETWORK_ERROR), 다시 시도하면 성공
 *   /rooms/room-4/edit?mock=busy        → 첫 저장 ROOM_BUSY(409), 다시 시도하면 성공
 *   /rooms/room-4/edit?mock=load-error  → 첫 조회 실패, 다시 시도하면 성공
 *   /rooms/room-2/edit                  → 내가 MEMBER 인 방 → 권한 없음 화면
 *
 * TODO(범위 밖): WS ROOM_UPDATED 수신 시 8.2 재조회로 isStale 갱신
 */
export default function RoomEditScreen() {
    const insets = useSafeAreaInsets();
    const { roomId, mock } = useLocalSearchParams<{ roomId: string; mock?: MockMode }>();

    const [detail, setDetail] = useState<RoomDetail | null>(null);
    const [loadError, setLoadError] = useState<LoadError | null>(null);
    const [loading, setLoading] = useState(true);

    // 폼 상태
    const [name, setName] = useState('');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [timeOpen, setTimeOpen] = useState(false);
    const [fieldError, setFieldError] = useState<{ name?: string; time?: string }>({});
    const [saveError, setSaveError] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [discardOpen, setDiscardOpen] = useState(false);
    const requestId = useRef(0);
    const active = useRef(true);
    const saveLock = useRef(false);
    const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const loadFailNext = useRef(mock === 'load-error');
    const saveFailNext = useRef<'error' | 'busy' | undefined>(mock === 'error' || mock === 'busy' ? mock : undefined);

    const fillForm = (room: RoomDetail) => {
        const at = room.appointmentAt ? new Date(room.appointmentAt) : null;
        setName(room.name);
        setDate(at ? toDateValue(at) : '');
        setTime(at ? formatTime(at) : '');
        setFieldError({});
        setSaveError('');
    };

    const load = useCallback(async () => {
        if (!roomId) return;
        const id = ++requestId.current;
        setLoading(true);
        setLoadError(null);
        try {
            const fail = loadFailNext.current;
            loadFailNext.current = false; // 다시 시도하면 성공하도록
            const room = await fetchRoomDetail(roomId, fail ? 'error' : undefined);
            if (id !== requestId.current) return;
            if (room.myRole !== 'OWNER') {
                // 명세 7.0: 방 정보 수정은 OWNER 만. MEMBER 는 NOT_ROOM_OWNER(403)
                setDetail(room);
                setLoadError('NOT_ROOM_OWNER');
                return;
            }
            setDetail(room);
            fillForm(room);
        } catch (error) {
            if (id !== requestId.current || error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            setDetail(null);
            const code = error instanceof RoomError ? error.code : null;
            setLoadError(code === 'ROOM_NOT_FOUND' || code === 'NOT_ROOM_MEMBER' ? code : 'UNKNOWN');
            if (code === 'NOT_ROOM_MEMBER') router.replace('/rooms');
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, [roomId]);

    // 화면에 들어올 때만 최신 방 정보로 폼을 채웁니다.
    // saving·saved 를 의존성에 넣으면 저장 요청이 끝날 때마다 다시 조회되어 입력값·오류가 사라져요.
    useFocusEffect(
        useCallback(() => {
            active.current = true;
            if (!saveLock.current) setSaving(false);
            void load();
            return () => {
                active.current = false;
                requestId.current++;
                if (backTimer.current) clearTimeout(backTimer.current);
            };
        }, [load]),
    );

    /* ───────── 변경 여부 계산 ───────── */

    const initialAt = detail?.appointmentAt ? new Date(detail.appointmentAt) : null;
    const nameChanged = !!detail && name.trim() !== detail.name;

    const pickedAt = (() => {
        if (!date || !time) return null;
        const [y, m, d] = date.split('-').map(Number);
        const [h, min] = time.split(':').map(Number);
        return new Date(y, m - 1, d, h, min);
    })();
    const timePartial = !!date !== !!time;
    const timeCleared = !!initialAt && !date && !time;
    const timeChanged =
        !timePartial && !timeCleared && (date !== (initialAt ? toDateValue(initialAt) : '') || time !== (initialAt ? formatTime(initialAt) : ''));

    const dirty = nameChanged || timeChanged || timeCleared || timePartial;
    const nameLength = roomNameLength(name);

    /* ───────── 저장 ───────── */

    const validate = () => {
        const errors: { name?: string; time?: string } = {};
        if (nameLength === 0) errors.name = '약속방 이름을 입력해 주세요.';
        else if (nameLength > ROOM_NAME_MAX) errors.name = `약속방 이름은 ${ROOM_NAME_MAX}자까지 쓸 수 있어요.`;
        if (timePartial) errors.time = '약속 날짜와 시간을 모두 고르거나, 둘 다 비워 두세요.';
        else if (pickedAt && timeChanged && pickedAt.getTime() < Date.now()) errors.time = '지금 이후의 약속 시각을 선택해 주세요.';
        setFieldError(errors);
        return Object.keys(errors).length === 0;
    };

    const save = async () => {
        if (!detail || saving || saved || saveLock.current) return;
        setSaveError('');
        if (!validate()) return;

        // 바꾼 필드만 보냅니다 (명세 7.5: 모든 필드 선택, 생략하면 유지)
        const patch: UpdateRoomPatch = {};
        if (nameChanged) patch.name = name;
        if (timeCleared) patch.appointmentAt = null; // 해제
        else if (timeChanged && pickedAt) patch.appointmentAt = pickedAt.toISOString(); // 변경
        if (Object.keys(patch).length === 0) return back();

        saveLock.current = true;
        const id = requestId.current;
        setSaving(true);
        try {
            const fail = saveFailNext.current;
            saveFailNext.current = undefined; // 다시 시도하면 성공하도록
            await updateRoom(detail.id, patch, fail);
            if (!active.current || id !== requestId.current) return;
            setSaved(true);
            // 저장 결과는 방 상세·목록이 다시 조회해서 반영합니다 (useFocusEffect)
            backTimer.current = setTimeout(() => { if (active.current && id === requestId.current) back(); }, 900);
        } catch (error) {
            if (!active.current || id !== requestId.current || error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            if (error instanceof RoomError && error.code === 'NOT_ROOM_MEMBER') { router.replace('/rooms'); return; }
            if (error instanceof RoomError && (error.code === 'NOT_ROOM_OWNER' || error.code === 'ROOM_NOT_FOUND')) {
                setLoadError(error.code);
                return;
            }
            setSaveError(error instanceof RoomError ? error.message : '변경 내용을 저장하지 못했어요. 다시 시도해 주세요.');
        } finally {
            saveLock.current = false;
            if (active.current) setSaving(false);
        }
    };

    const back = () => (router.canGoBack() ? router.back() : router.replace(`/rooms/${roomId}`));
    const cancel = () => (dirty && !saved ? setDiscardOpen(true) : back());

    /* ───────── 렌더 ───────── */

    const header = (
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
            <Pressable style={styles.backButton} onPress={cancel} accessibilityRole="button" accessibilityLabel="취소하고 돌아가기" hitSlop={8}>
                <Ionicons name="chevron-back" size={26} color={NAVY} />
            </Pressable>
            <Text style={styles.headerTitle}>방 정보 수정</Text>
            <View style={styles.headerRight}>
                {detail?.myRole === 'OWNER' && !loadError && (
                    <View style={styles.ownerChip}>
                        <Ionicons name="key-outline" size={12} color={MINT_DEEP} />
                        <Text style={styles.ownerChipText}>방장</Text>
                    </View>
                )}
            </View>
        </View>
    );

    if (loading && !detail) {
        return (
            <View style={styles.container}>
                <StatusBar style="dark" />
                {header}
                <View style={styles.center}>
                    <ActivityIndicator color={NAVY} />
                    <Text style={styles.centerHint}>약속방 정보를 불러오고 있어요</Text>
                </View>
            </View>
        );
    }

    if (loadError) {
        const copy = {
            NOT_ROOM_OWNER: { icon: 'lock-closed-outline' as const, title: '방장만 수정할 수 있어요', body: `${detail?.name ?? '이 약속방'}의 이름과 약속 시각은 방장이 바꿀 수 있어요. 바꾸고 싶은 내용은 채팅으로 방장에게 알려주세요.` },
            ROOM_NOT_FOUND: { icon: 'help-circle-outline' as const, title: '약속방을 찾을 수 없어요', body: '삭제됐거나 없는 약속방이에요.' },
            NOT_ROOM_MEMBER: { icon: 'person-remove-outline' as const, title: '참여하지 않은 약속방이에요', body: '초대 코드로 먼저 참여해 주세요.' },
            UNKNOWN: { icon: 'cloud-offline-outline' as const, title: '정보를 불러오지 못했어요', body: '네트워크 상태를 확인하고 다시 시도해 주세요.' },
        }[loadError];
        return (
            <View style={styles.container}>
                <StatusBar style="dark" />
                {header}
                <View style={styles.center}>
                    <View style={styles.centerIcon}>
                        <Ionicons name={copy.icon} size={30} color={SECONDARY} />
                    </View>
                    <Text style={styles.centerTitle}>{copy.title}</Text>
                    <Text style={styles.centerBody}>{copy.body}</Text>
                    <View style={styles.centerActions}>
                        {loadError === 'UNKNOWN' && (
                            <Pressable style={styles.primaryButton} onPress={load} accessibilityRole="button">
                                <Text style={styles.primaryText}>다시 시도</Text>
                            </Pressable>
                        )}
                        <Pressable style={styles.secondaryButton} onPress={back} accessibilityRole="button">
                            <Text style={styles.secondaryText}>{loadError === 'NOT_ROOM_OWNER' ? '약속방으로 돌아가기' : '돌아가기'}</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />
            {header}

            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                >
                    {/* 현재 값 요약 */}
                    {detail && (
                        <View style={styles.currentCard}>
                            <Text style={styles.currentLabel}>지금 설정</Text>
                            <Text style={styles.currentName} numberOfLines={1}>{detail.name}</Text>
                            <Text style={styles.currentTime}>
                                {initialAt ? formatAppointment(initialAt) : '약속 시각 미정'}
                            </Text>
                        </View>
                    )}

                    {/* ❶ 약속 이름 */}
                    <View style={styles.field}>
                        <View style={styles.rowBetween}>
                            <Text style={styles.fieldLabel}>약속 이름</Text>
                            <Text style={[styles.counter, nameLength > ROOM_NAME_MAX && styles.counterOver]}>
                                {nameLength}/{ROOM_NAME_MAX}
                            </Text>
                        </View>
                        <TextInput
                            style={[styles.input, !!fieldError.name && styles.inputError]}
                            value={name}
                            onChangeText={value => { setName(value); setFieldError(prev => ({ ...prev, name: undefined })); setSaveError(''); }}
                            placeholder="약속 이름을 입력하세요"
                            placeholderTextColor="#a1a8b8"
                            maxLength={ROOM_NAME_MAX + 10}
                            returnKeyType="done"
                            editable={!saving && !saved}
                            accessibilityLabel="약속 이름"
                        />
                        {!!fieldError.name && <Text style={styles.fieldErrorText}>{fieldError.name}</Text>}
                        {nameChanged && !fieldError.name && <ChangeTag text="이름이 바뀌어요" />}
                    </View>

                    {/* ❷ 약속 시각 */}
                    <View style={styles.field}>
                        <View style={styles.rowBetween}>
                            <Text style={styles.fieldLabel}>약속 시각 <Text style={styles.optional}>(선택)</Text></Text>
                            {!!(date || time) && !saving && !saved && (
                                <Pressable
                                    onPress={() => { setDate(''); setTime(''); setFieldError(prev => ({ ...prev, time: undefined })); setSaveError(''); }}
                                    style={styles.clearLink}
                                    accessibilityRole="button"
                                    accessibilityLabel="약속 시각 해제"
                                    hitSlop={6}
                                >
                                    <Ionicons name="close-circle" size={15} color={SECONDARY} />
                                    <Text style={styles.clearText}>해제</Text>
                                </Pressable>
                            )}
                        </View>
                        <View style={styles.pickRow}>
                            <Pressable
                                style={[styles.pickBox, !!fieldError.time && styles.inputError]}
                                onPress={() => setCalendarOpen(true)}
                                disabled={saving || saved}
                                accessibilityRole="button"
                                accessibilityLabel="약속 날짜 선택"
                            >
                                <Ionicons name="calendar-outline" size={18} color={NAVY} />
                                <Text style={[styles.pickText, !date && styles.placeholder]}>{date || '날짜'}</Text>
                            </Pressable>
                            <Pressable
                                style={[styles.pickBox, !!fieldError.time && styles.inputError]}
                                onPress={() => setTimeOpen(true)}
                                disabled={saving || saved}
                                accessibilityRole="button"
                                accessibilityLabel="약속 시간 선택"
                            >
                                <Ionicons name="time-outline" size={18} color={NAVY} />
                                <Text style={[styles.pickText, !time && styles.placeholder]}>{time || '시간'}</Text>
                            </Pressable>
                        </View>
                        {!!fieldError.time && <Text style={styles.fieldErrorText}>{fieldError.time}</Text>}
                        {timeCleared && <ChangeTag text="약속 시각을 해제해요" tone="warn" />}
                        {timeChanged && !fieldError.time && <ChangeTag text="약속 시각이 바뀌어요" />}

                        {/* 설계 ❷: 시각이 바뀌면 이전 추천 결과는 최신이 아니게 됩니다. 저장만으로 자동 재추천하지 않아요 */}
                        <View style={styles.staleNote}>
                            <Ionicons name="alert-circle-outline" size={16} color={ORANGE} />
                            <Text style={styles.staleText}>
                                약속 시각을 바꾸면 이전 추천 결과는 &apos;최신이 아님&apos;으로 표시돼요. 추천·후보·확정 약속역은 그대로 남고, 자동으로 다시 추천하지 않아요.
                            </Text>
                        </View>
                    </View>

                    {!!saveError && (
                        <View style={styles.saveError}>
                            <Ionicons name="warning-outline" size={16} color={RED} />
                            <Text style={styles.saveErrorText}>{saveError}</Text>
                        </View>
                    )}
                </ScrollView>

                {/* ❸ 저장 / 취소 */}
                <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
                    {saved ? (
                        <View style={styles.savedBanner}>
                            <Ionicons name="checkmark-circle" size={18} color={MINT_DEEP} />
                            <Text style={styles.savedText}>저장했어요. 약속방으로 돌아갈게요.</Text>
                        </View>
                    ) : (
                        <Text style={styles.footerHint}>
                            {dirty ? '바꾼 항목만 저장돼요.' : '바꾼 내용이 없어요.'}
                        </Text>
                    )}
                    <Pressable
                        style={({ pressed }) => [styles.primaryButton, (!dirty || saving || saved) && styles.primaryDisabled, pressed && styles.pressed]}
                        onPress={save}
                        disabled={!dirty || saving || saved}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !dirty || saving || saved, busy: saving }}
                    >
                        {saving ? <ActivityIndicator color={WHITE} /> : <Text style={styles.primaryText}>{saveError ? '다시 시도' : '저장'}</Text>}
                    </Pressable>
                    <Pressable style={styles.secondaryButton} onPress={cancel} disabled={saving || saved} accessibilityRole="button">
                        <Text style={styles.secondaryText}>취소</Text>
                    </Pressable>
                </View>
            </KeyboardAvoidingView>

            <CalendarModal visible={calendarOpen} value={date} onClose={() => setCalendarOpen(false)} onConfirm={value => { setDate(value); setFieldError(prev => ({ ...prev, time: undefined })); setSaveError(''); }} />
            <TimeWheelModal visible={timeOpen} value={time || '19:00'} onClose={() => setTimeOpen(false)} onConfirm={value => { setTime(value); setFieldError(prev => ({ ...prev, time: undefined })); setSaveError(''); }} />

            {/* 변경 중 취소 확인 */}
            <Modal visible={discardOpen} transparent animationType="fade" onRequestClose={() => setDiscardOpen(false)}>
                <Pressable style={styles.dim} onPress={() => setDiscardOpen(false)} accessibilityLabel="닫기" />
                <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
                    <View style={styles.grabber} />
                    <Text style={styles.sheetTitle}>바꾼 내용을 버릴까요?</Text>
                    <Text style={styles.sheetBody}>저장하지 않은 변경 내용은 사라져요.</Text>
                    <Pressable style={[styles.primaryButton, styles.dangerButton]} onPress={() => { setDiscardOpen(false); back(); }} accessibilityRole="button">
                        <Text style={styles.primaryText}>버리고 나가기</Text>
                    </Pressable>
                    <Pressable style={styles.secondaryButton} onPress={() => setDiscardOpen(false)} accessibilityRole="button">
                        <Text style={styles.secondaryText}>계속 수정하기</Text>
                    </Pressable>
                </View>
            </Modal>
        </View>
    );
}

function ChangeTag({ text, tone = 'info' }: { text: string; tone?: 'info' | 'warn' }) {
    const warn = tone === 'warn';
    return (
        <View style={[styles.changeTag, warn && styles.changeTagWarn]}>
            <Ionicons name={warn ? 'remove-circle-outline' : 'sync-outline'} size={13} color={warn ? ORANGE : MINT_DEEP} />
            <Text style={[styles.changeTagText, warn && styles.changeTagTextWarn]}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    flex: { flex: 1 },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingBottom: 10,
        backgroundColor: WHITE,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },
    backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: NAVY, letterSpacing: -0.3 },
    headerRight: { width: 64, alignItems: 'flex-end' },
    ownerChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: '#e6f8f1' },
    ownerChipText: { fontSize: 11, fontWeight: '800', color: MINT_DEEP },

    content: { padding: 20, gap: 22 },

    currentCard: { backgroundColor: NAVY, borderRadius: 18, padding: 16, gap: 4 },
    currentLabel: { fontSize: 11, fontWeight: '800', color: MINT, letterSpacing: 0.3 },
    currentName: { fontSize: 18, fontWeight: '800', color: WHITE, letterSpacing: -0.3 },
    currentTime: { fontSize: 13, fontWeight: '500', color: '#b7c0d6' },

    field: { gap: 8 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    fieldLabel: { fontSize: 14, fontWeight: '800', color: NAVY },
    optional: { fontSize: 12, fontWeight: '600', color: SECONDARY },
    counter: { fontSize: 12, fontWeight: '600', color: SECONDARY },
    counterOver: { color: RED },

    input: {
        height: 54,
        paddingHorizontal: 16,
        borderRadius: 16,
        backgroundColor: WHITE,
        borderWidth: 1.5,
        borderColor: BORDER,
        fontSize: 16,
        fontWeight: '600',
        color: NAVY,
        ...Platform.select({ web: { outlineStyle: 'none' } as object }),
    },
    inputError: { borderColor: RED },
    fieldErrorText: { fontSize: 12.5, fontWeight: '600', color: RED },

    pickRow: { flexDirection: 'row', gap: 10 },
    pickBox: {
        flex: 1,
        height: 54,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        borderRadius: 16,
        backgroundColor: WHITE,
        borderWidth: 1.5,
        borderColor: BORDER,
    },
    pickText: { fontSize: 15, fontWeight: '700', color: NAVY },
    placeholder: { color: '#a1a8b8', fontWeight: '600' },
    clearLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    clearText: { fontSize: 12.5, fontWeight: '700', color: SECONDARY },

    changeTag: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: '#e6f8f1' },
    changeTagWarn: { backgroundColor: '#fff4e0' },
    changeTagText: { fontSize: 12, fontWeight: '700', color: MINT_DEEP },
    changeTagTextWarn: { color: ORANGE },

    staleNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#fff4e0', marginTop: 4 },
    staleText: { flex: 1, fontSize: 12.5, lineHeight: 19, fontWeight: '500', color: '#7a4e00' },

    saveError: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#fdecef' },
    saveErrorText: { flex: 1, fontSize: 13, fontWeight: '600', color: RED },

    footer: { paddingHorizontal: 20, paddingTop: 12, gap: 10, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
    footerHint: { textAlign: 'center', fontSize: 12.5, fontWeight: '600', color: SECONDARY },
    savedBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
    savedText: { fontSize: 13, fontWeight: '700', color: MINT_DEEP },

    primaryButton: { height: 54, borderRadius: 16, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
    primaryDisabled: { backgroundColor: '#b9c0cf' },
    dangerButton: { backgroundColor: RED },
    primaryText: { fontSize: 15, fontWeight: '800', color: WHITE },
    secondaryButton: { height: 50, borderRadius: 16, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { fontSize: 15, fontWeight: '700', color: NAVY },
    pressed: { opacity: 0.85 },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, paddingBottom: 60, gap: 8 },
    centerHint: { marginTop: 8, fontSize: 13, fontWeight: '600', color: SECONDARY },
    centerIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    centerTitle: { fontSize: 17, fontWeight: '800', color: NAVY, textAlign: 'center', letterSpacing: -0.3 },
    centerBody: { fontSize: 13.5, lineHeight: 20, fontWeight: '500', color: SECONDARY, textAlign: 'center' },
    centerActions: { alignSelf: 'stretch', gap: 10, marginTop: 18 },

    dim: { flex: 1, backgroundColor: 'rgba(15,28,63,0.42)' },
    sheet: { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, gap: 12 },
    grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#d9dde4', alignSelf: 'center', marginBottom: 6 },
    sheetTitle: { fontSize: 18, fontWeight: '800', color: NAVY, letterSpacing: -0.3 },
    sheetBody: { fontSize: 14, lineHeight: 21, fontWeight: '500', color: SECONDARY, marginBottom: 6 },
});
