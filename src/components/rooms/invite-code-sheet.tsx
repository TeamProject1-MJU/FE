import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ApiError, isAuthError } from '@/services/api/errors';
import { fetchInviteCode } from '@/services/room';
import { RoomError, type RoomErrorCode } from '@/types/room';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const MINT_DEEP = '#12a77a';
const WHITE = '#ffffff';
const BG = '#f3f5f8';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const RED = '#d6455d';

type State =
    | { status: 'loading' }
    | { status: 'success'; roomCode: string }
    | { status: 'error'; code: RoomErrorCode; message: string };

type Props = {
    visible: boolean;
    roomId: string;
    roomName: string;
    bottomInset: number;
    onClose: () => void;
    /** 화면 확인용: 첫 조회를 실패시킵니다 (다시 시도하면 성공) */
    mockError?: boolean;
    onAccessError?: (code: RoomErrorCode) => void;
};

/**
 * 초대 코드 시트 (#47, 설계서 그림 28 ❻·그림 38 ❶, 명세 7.9 GET /rooms/{roomId}/invite-code)
 *
 * - 방장(현재 OWNER)만 열 수 있어요. 열 때마다 7.9 를 다시 조회합니다 (방장이 바뀌었으면 NOT_ROOM_OWNER).
 * - 조회 중 / 성공(코드 + 복사) / 실패(다시 시도) 상태를 가집니다.
 * - 복사는 화면에 보이는 roomCode 문자열을 그대로 클립보드에 넣어요.
 * TODO: 외부 공유(Share 시트) (이슈 미정)
 */
export default function InviteCodeSheet({ visible, roomId, roomName, bottomInset, onClose, mockError, onAccessError }: Props) {
    const [state, setState] = useState<State>({ status: 'loading' });
    const [copied, setCopied] = useState(false);
    const failNext = useRef(false);
    const requestId = useRef(0);
    const busy = useRef(false);
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async () => {
        if (busy.current) return;
        busy.current = true;
        const id = ++requestId.current;
        setState({ status: 'loading' });
        setCopied(false);
        try {
            const fail = failNext.current;
            failNext.current = false; // 다시 시도하면 성공하도록
            const { roomCode } = await fetchInviteCode(roomId, fail ? 'error' : undefined);
            if (id === requestId.current) setState({ status: 'success', roomCode });
        } catch (error) {
            if (id !== requestId.current || error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            const code: RoomErrorCode = error instanceof RoomError ? error.code : 'NETWORK_ERROR';
            const message = error instanceof RoomError ? error.message : '초대 코드를 불러오지 못했어요.';
            setState({ status: 'error', code, message });
            if (code === 'NOT_ROOM_OWNER' || code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND') onAccessError?.(code);
        } finally {
            if (id === requestId.current) busy.current = false;
        }
    }, [roomId, onAccessError]);

    const cancelRequest = useCallback(() => {
        requestId.current++;
        busy.current = false;
        if (copyTimer.current) clearTimeout(copyTimer.current);
    }, []);

    // 열릴 때마다 새로 조회 (방장 위임 등으로 권한이 바뀌었을 수 있어요)
    useEffect(() => {
        cancelRequest();
        if (!visible) return;
        failNext.current = !!mockError;
        const id = requestId.current;
        // 같은 프레임에 닫힌 시트의 예약 조회도 취소해요.
        void Promise.resolve().then(() => { if (id === requestId.current) return load(); });
        return cancelRequest;
    }, [visible, mockError, load, cancelRequest]);

    const copy = async () => {
        if (state.status !== 'success') return;
        await Clipboard.setStringAsync(state.roomCode);
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 2000);
    };

    const retryable = state.status === 'error' && (state.code === 'NETWORK_ERROR' || state.code === 'ROOM_BUSY' || state.code === 'UNKNOWN_ERROR');

    return (
        <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="닫기" />
                <View style={[styles.sheet, { paddingBottom: bottomInset + 20 }]}>
                    <View style={styles.grabber} />

                    <View style={styles.titleRow}>
                        <View style={styles.titleIcon}>
                            <Ionicons name="key-outline" size={18} color={MINT_DEEP} />
                        </View>
                        <View style={styles.titleBody}>
                            <Text style={styles.title}>초대 코드</Text>
                            <Text style={styles.subtitle} numberOfLines={1}>{roomName}</Text>
                        </View>
                        <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" hitSlop={8}>
                            <Ionicons name="close" size={20} color={SECONDARY} />
                        </Pressable>
                    </View>

                    {state.status === 'loading' && (
                        <View style={styles.codeBox}>
                            <ActivityIndicator color={NAVY} />
                            <Text style={styles.loadingText}>초대 코드를 불러오고 있어요</Text>
                        </View>
                    )}

                    {state.status === 'success' && (
                        <>
                            <Pressable
                                style={({ pressed }) => [styles.codeBox, styles.codeBoxReady, pressed && styles.pressed]}
                                onPress={copy}
                                accessibilityRole="button"
                                accessibilityLabel={`초대 코드 ${state.roomCode.split('').join(' ')}, 눌러서 복사`}
                            >
                                <View style={styles.codeRow}>
                                    {state.roomCode.split('').map((char, index) => (
                                        <View key={index} style={styles.codeCell}>
                                            <Text style={styles.codeChar}>{char}</Text>
                                        </View>
                                    ))}
                                </View>
                                <Text style={styles.codeHint}>영문 대문자·숫자 6자리 · 눌러서 복사</Text>
                            </Pressable>

                            <Pressable
                                style={({ pressed }) => [styles.primaryButton, copied && styles.primaryCopied, pressed && styles.pressed]}
                                onPress={copy}
                                accessibilityRole="button"
                                accessibilityLabel="초대 코드 복사"
                            >
                                <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={18} color={WHITE} />
                                <Text style={styles.primaryText}>{copied ? '복사했어요' : '코드 복사'}</Text>
                            </Pressable>

                            <View style={styles.note}>
                                <Ionicons name="information-circle-outline" size={16} color={SECONDARY} />
                                <Text style={styles.noteText}>
                                    친구에게 이 코드를 직접 전달해 주세요. 상대는 약속 목록의 &apos;초대 코드로 참여&apos;에서 입력해요. 방장이 바뀌면 새 방장이 코드를 볼 수 있어요.
                                </Text>
                            </View>
                        </>
                    )}

                    {state.status === 'error' && (
                        <>
                            <View style={[styles.codeBox, styles.codeBoxError]}>
                                <Ionicons
                                    name={state.code === 'NOT_ROOM_OWNER' ? 'lock-closed-outline' : 'cloud-offline-outline'}
                                    size={28}
                                    color={state.code === 'NOT_ROOM_OWNER' ? SECONDARY : RED}
                                />
                                <Text style={styles.errorTitle}>
                                    {state.code === 'NOT_ROOM_OWNER' ? '지금은 방장이 아니에요' : '초대 코드를 불러오지 못했어요'}
                                </Text>
                                <Text style={styles.errorBody}>
                                    {state.code === 'NOT_ROOM_OWNER'
                                        ? '초대 코드는 현재 방장만 볼 수 있어요. 방장이 바뀌었다면 새 방장에게 요청해 주세요.'
                                        : state.message}
                                </Text>
                            </View>
                            {retryable ? (
                                <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={load} accessibilityRole="button">
                                    <Ionicons name="refresh" size={18} color={WHITE} />
                                    <Text style={styles.primaryText}>다시 시도</Text>
                                </Pressable>
                            ) : (
                                <Pressable style={styles.secondaryButton} onPress={onClose} accessibilityRole="button">
                                    <Text style={styles.secondaryText}>닫기</Text>
                                </Pressable>
                            )}
                        </>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,28,63,0.42)' },
    sheet: { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, gap: 16 },
    grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#d9dde4', alignSelf: 'center' },

    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    titleIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#e6f8f1', alignItems: 'center', justifyContent: 'center' },
    titleBody: { flex: 1, gap: 2 },
    title: { fontSize: 18, fontWeight: '800', color: NAVY, letterSpacing: -0.3 },
    subtitle: { fontSize: 12.5, fontWeight: '600', color: SECONDARY },
    closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

    codeBox: { minHeight: 124, borderRadius: 18, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 18 },
    codeBoxReady: { borderColor: MINT, borderWidth: 1.5 },
    codeBoxError: { backgroundColor: '#fdf6f7', borderColor: '#f3d2d8' },
    loadingText: { fontSize: 13, fontWeight: '600', color: SECONDARY },

    codeRow: { flexDirection: 'row', gap: 8 },
    codeCell: { width: 42, height: 52, borderRadius: 12, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
    codeChar: { fontSize: 24, fontWeight: '800', color: NAVY, fontVariant: ['tabular-nums'] },
    codeHint: { fontSize: 12, fontWeight: '600', color: SECONDARY },

    errorTitle: { fontSize: 15, fontWeight: '800', color: NAVY, textAlign: 'center' },
    errorBody: { fontSize: 12.5, lineHeight: 19, fontWeight: '500', color: SECONDARY, textAlign: 'center' },

    primaryButton: { height: 54, borderRadius: 16, backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    primaryCopied: { backgroundColor: MINT_DEEP },
    primaryText: { fontSize: 15, fontWeight: '800', color: WHITE },
    secondaryButton: { height: 50, borderRadius: 16, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { fontSize: 15, fontWeight: '700', color: NAVY },
    pressed: { opacity: 0.85 },

    note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    noteText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '500', color: SECONDARY },
});
