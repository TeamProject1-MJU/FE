import MemberAvatar, { memberTone } from '@/components/rooms/member-avatar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
    ActivityIndicator,
    Keyboard,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
    useWindowDimensions,
} from 'react-native';
import { Text, TextInput } from '@/components/app-text';

import type { useRoomChat } from '@/hooks/use-room-chat';
import { parseChatEmphasis, toChatDisplayContent } from '@/services/chat';
import { useMock as isMockMode } from '@/services/api/config';
import type { PendingChatMessage } from '@/types/chat';
import type { RoomMember } from '@/types/room';

const NAVY = '#25212D';
const MINT = '#5C3F78';
const SECONDARY = '#83808B';

const clock = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    minute: '2-digit',
});

const calendar = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
});

type Row = {
    id: string;
    kind: 'mine' | 'other' | 'ai' | 'system';
    name: string;
    content: string;
    createdAt: string;
    pending?: PendingChatMessage;
};

function dateLabel(value: string, dateOnly = false) {
    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? ''
        : (dateOnly ? calendar : clock).format(date);
}

export default function RoomChatPanel({
                                          controller,
                                          myUserId,
                                          members,
                                          ownerId,
                                          panelHeight,
                                          onInputFocus,
                                      }: {
    controller: ReturnType<typeof useRoomChat>;
    myUserId: string;
    members: RoomMember[];
    ownerId?: string;
    panelHeight?: number;
    onInputFocus?: () => void;
}) {
    const { height: windowHeight } = useWindowDimensions();
    const listHeight = Math.max(360, windowHeight - 260);
    const fittedPanelHeight = panelHeight == null ? undefined : Math.max(360, panelHeight);
    const list = useRef<ScrollView>(null);
    const input = useRef<TextInput>(null);
    const nearBottom = useRef(true);
    const lastContent = useRef('');
    const lastPending = useRef(new Set<string>());
    const initialized = useRef(false);
    const followBottom = useRef(true);
    const viewportHeight = useRef(0);
    const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sentDraft = useRef<string | null>(null);
    const contentHeight = useRef(0);
    const scrollOffset = useRef(0);
    const anchor = useRef<{
        height: number;
        offset: number;
    } | null>(null);

    const [inputFocused, setInputFocused] = useState(false);
    const [newMessages, setNewMessages] = useState(false);

    useEffect(() => {
        const subscription = Keyboard.addListener(
            'keyboardDidShow',
            () => {
                if (input.current?.isFocused()) {
                    onInputFocus?.();
                }
            },
        );

        return () => subscription.remove();
    }, [onInputFocus]);

    const rows = useMemo<Row[]>(() => {
        const saved: Row[] = controller.messages.map(message => {
            const mine =
                message.senderType === 'USER' &&
                message.senderId === myUserId;

            const nickname =
                (!isMockMode() ? message.nickname : null) ?? members.find(
                    member => member.userId === message.senderId,
                )?.nickname ??
                message.nickname ??
                '나간 사용자';

            return {
                id: message.id,
                kind:
                    message.senderType === 'SYSTEM'
                        ? 'system'
                        : message.senderType === 'AI'
                            ? 'ai'
                            : mine
                                ? 'mine'
                                : 'other',
                name:
                    message.senderType === 'AI'
                        ? (isMockMode() ? '@링크로' : '링크로')
                        : mine
                            ? `${nickname} · 나`
                            : nickname,
                content: toChatDisplayContent(message.content),
                createdAt: message.createdAt,
            };
        });

        const sending: Row[] = controller.pending.map(message => ({
            id: message.clientId,
            kind: 'mine',
            name: '나',
            content: toChatDisplayContent(message.content),
            createdAt: message.createdAt,
            pending: message,
        }));

        return [...saved, ...sending].sort(
            (a, b) =>
                Date.parse(a.createdAt) - Date.parse(b.createdAt),
        );
    }, [
        controller.messages,
        controller.pending,
        members,
        myUserId,
    ]);

    // 새 메시지뿐 아니라 답변 상태·키보드로 목록 높이가 달라진 뒤에도 최종 배치를 따라가요.
    const scheduleLatest = useCallback(() => {
        if (scrollTimer.current) clearTimeout(scrollTimer.current);
        scrollTimer.current = setTimeout(() => {
            scrollTimer.current = null;
            if (!anchor.current && followBottom.current) list.current?.scrollToEnd({ animated: false });
        }, 16);
    }, []);
    useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); }, []);

    useEffect(() => {
        if (controller.status !== 'ready') return;
        const latest = controller.messages.at(-1);
        const pendingIds = new Set(controller.pending.map(message => message.clientId));
        const newPending = [...pendingIds].some(id => !lastPending.current.has(id));
        const changed = (latest?.id ?? '') !== lastContent.current;
        const first = !initialized.current;
        // 전송 확정(임시 메시지 → 서버 ID)은 새 전송이 아니므로, 그 사이 위로 읽기 시작했다면 위치를 지켜요.
        const sentByMe = newPending;
        initialized.current = true;
        lastContent.current = latest?.id ?? '';
        lastPending.current = pendingIds;
        if (!first && !changed && !newPending) return;
        if (!anchor.current && (first || followBottom.current || nearBottom.current || sentByMe)) {
            followBottom.current = true;
            nearBottom.current = true;
            setNewMessages(false);
            scheduleLatest();
        } else if (changed && !first && !(latest?.senderType === 'USER' && latest.senderId === myUserId)) setNewMessages(true);
    }, [controller.status, controller.messages, controller.pending, myUserId, scheduleLatest]);

    useEffect(() => { if (controller.draft !== sentDraft.current) sentDraft.current = null; }, [controller.draft]);
    const sendDraft = (submitted?: string) => {
        if (!controller.canSend) return;
        const text = submitted ?? controller.draft;
        if (sentDraft.current === text) return;
        sentDraft.current = text;
        if (submitted !== undefined) controller.setDraft(submitted);
        followBottom.current = true;
        nearBottom.current = true;
        setNewMessages(false);
        controller.send();
        scheduleLatest();
    };
    const mentioned = /@링크로|@linkro/i.test(controller.draft);
    const addMention = () => {
        if (!mentioned) controller.setDraft(`@링크로 ${controller.draft}`);
        input.current?.focus();
    };
    const jumpToLatest = () => {
        followBottom.current = true;
        nearBottom.current = true;
        setNewMessages(false);
        list.current?.scrollToEnd({ animated: true });
        scheduleLatest();
    };
    const latestRow = rows.at(-1);
    const latestPreview = latestRow?.kind === 'ai'
        ? parseChatEmphasis(latestRow.content).map(part => part.text).join('')
        : latestRow?.content ?? '';

    const loadOlder = () => {
        if (controller.historyLoading || !controller.hasMore) return;

        anchor.current = {
            height: contentHeight.current,
            offset: scrollOffset.current,
        };

        void controller.loadOlder();
    };

    if (controller.status !== 'ready') {
        return (
            <View style={[styles.panel, fittedPanelHeight != null && { height: fittedPanelHeight, flexShrink: 0 }]}>
                <View
                    style={styles.empty}
                    accessibilityLiveRegion="polite"
                >
                    {controller.status === 'loading' && (
                        <ActivityIndicator color={NAVY} />
                    )}

                    <Text style={styles.body}>
                        {controller.status === 'loading'
                            ? '대화를 불러오는 중이에요'
                            : controller.error}
                    </Text>

                    {controller.status === 'error' && (
                        <Action
                            label={
                                controller.blocked
                                    ? '약속방 목록으로'
                                    : '다시 시도'
                            }
                            onPress={
                                controller.blocked
                                    ? () => router.replace('/rooms')
                                    : () => {
                                        void controller.reload();
                                    }
                            }
                        />
                    )}
                </View>
            </View>
        );
    }

    const messageSenders = new Map(controller.messages.map(message => [message.id, message.senderId]));

    return (
        <View style={[styles.panel, fittedPanelHeight != null && { height: fittedPanelHeight, flexShrink: 0 }]}>
            {controller.error && (
                <View
                    style={styles.errorBox}
                    accessibilityLiveRegion="polite"
                >
                    <Text style={styles.errorText}>
                        {controller.error}
                    </Text>
                    <Action
                        label="다시 불러오기"
                        disabled={controller.refreshing}
                        onPress={() => {
                            void controller.reload();
                        }}
                    />
                </View>
            )}

            <View style={[styles.listFrame, fittedPanelHeight != null ? styles.fillList : { height: listHeight }]}>
            <ScrollView
                ref={list}
                style={[styles.list, styles.fillList]}
                onLayout={({ nativeEvent }) => {
                    viewportHeight.current = nativeEvent.layout.height;
                    if (followBottom.current && !anchor.current) scheduleLatest();
                }}
                onScrollBeginDrag={() => {
                    // 손으로 위로 읽기 시작하면 예약된 이동보다 사용자 위치를 우선해요.
                    followBottom.current = false;
                    if (scrollTimer.current) clearTimeout(scrollTimer.current);
                }}
                contentContainerStyle={styles.listContent}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                maintainVisibleContentPosition={{
                    minIndexForVisible: 1,
                }}
                scrollEventThrottle={32}
                onScroll={({ nativeEvent }) => {
                    if (!isMockMode() && !controller.historyError && nativeEvent.contentOffset.y <= 40) loadOlder();
                    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
                    const wasOffset = scrollOffset.current;
                    // 웹은 scrollHeight(정수)와 레이아웃 높이(소수)가 섞이므로 1px 이내는 같은 배치로 봐요.
                    const resized = Math.abs(contentSize.height - contentHeight.current) > 1 || Math.abs(layoutMeasurement.height - viewportHeight.current) > 1;
                    scrollOffset.current = contentOffset.y;
                    const close = contentSize.height - layoutMeasurement.height - contentOffset.y <= 60;
                    if (close) {
                        nearBottom.current = true;
                        followBottom.current = true;
                        setNewMessages(false);
                    } else if (!followBottom.current || !resized && contentOffset.y < wasOffset - 1) {
                        nearBottom.current = false;
                        followBottom.current = false;
                        if (scrollTimer.current) clearTimeout(scrollTimer.current);
                    }
                }}
                onContentSizeChange={(_, height) => {
                    contentHeight.current = height;

                    if (anchor.current) {
                        list.current?.scrollTo({
                            y: Math.max(
                                0,
                                anchor.current.offset +
                                height -
                                anchor.current.height,
                            ),
                            animated: false,
                        });

                        if (!controller.historyLoading) {
                            anchor.current = null;
                        }
                        return;
                    }

                    if (followBottom.current) scheduleLatest();
                }}
            >
                <View style={styles.history}>
                    {controller.historyLoading ? (
                        <ActivityIndicator color={NAVY} />
                    ) : (
                        controller.hasMore && (
                            <Action
                                label={
                                    controller.historyError
                                        ? '이전 메시지 다시 불러오기'
                                        : '이전 메시지 더 보기'
                                }
                                onPress={loadOlder}
                            />
                        )
                    )}

                    {controller.historyError && (
                        <Text style={styles.errorText}>
                            {controller.historyError}
                        </Text>
                    )}
                </View>

                {rows.length === 0 && (
                    <View style={styles.empty}>
                        <Text style={styles.emptyTitle}>
                            대화를 시작해 봐요
                        </Text>
                        <Text style={styles.body}>
                            @링크로를 불러 이동과 약속에 관해 질문해요.
                        </Text>
                    </View>
                )}

                {rows.map((message, index) => {
                    const senderId = messageSenders.get(message.id);
                    const sender = members.find(member => member.userId === senderId);
                    const day = dateLabel(
                        message.createdAt,
                        true,
                    );
                    const showDay =
                        index === 0 ||
                        day !==
                        dateLabel(
                            rows[index - 1].createdAt,
                            true,
                        );

                    return (
                        <View key={message.id}>
                            {showDay && (
                                <Text style={styles.day}>{day}</Text>
                            )}

                            {message.kind === 'system' ? (
                                <View style={styles.system}>
                                    <Text style={styles.systemText}>
                                        {message.content}
                                    </Text>
                                    <Text style={styles.systemText}>
                                        {' · '}{dateLabel(message.createdAt)}
                                    </Text>
                                </View>
                            ) : (
                                <View
                                    style={[
                                        styles.message,
                                        message.kind === 'mine' &&
                                        styles.mine,
                                    ]}
                                >
                                    {message.kind === 'other' && (
                                        <MemberAvatar tone={sender ? memberTone(sender.userId, myUserId) : 'off'} size={26} isOwner={!!sender && sender.userId === ownerId} />
                                    )}
                                    {message.kind === 'ai' && <View style={styles.aiAvatar}><Text style={styles.aiAvatarText}>LR</Text></View>}
                                    <View style={[styles.messageBody, message.kind === 'mine' && styles.mineBody]}>
                                        <Text style={[styles.meta, message.kind === 'ai' && styles.aiName]}>
                                            {message.kind === 'mine' ? dateLabel(message.createdAt) : `${message.name} · ${dateLabel(message.createdAt)}`}
                                        </Text>

                                        <View
                                            style={[
                                                styles.bubble,
                                                message.kind === 'mine' &&
                                                styles.mineBubble,
                                                message.kind === 'ai' &&
                                                styles.aiBubble,
                                            ]}
                                        >
                                            <Text
                                                selectable
                                                style={[
                                                    styles.messageText,
                                                    message.kind ===
                                                    'mine' &&
                                                    styles.mineText,
                                                ]}
                                            >
                                                {message.kind === 'ai'
                                                    ? parseChatEmphasis(message.content).map((part, index) => (
                                                        <Text key={index} style={part.emphasized ? styles.emphasis : undefined}>{part.text}</Text>
                                                    ))
                                                    : message.content}
                                            </Text>
                                        </View>

                                        {message.pending?.status ===
                                            'sending' && (
                                                <Text style={styles.meta}>
                                                    보내는 중이에요…
                                                </Text>
                                            )}

                                        {message.pending?.status ===
                                            'failed' && (
                                                <View
                                                    style={styles.failure}
                                                    accessibilityLiveRegion="polite"
                                                >
                                                    <Text
                                                        style={
                                                            styles.errorText
                                                        }
                                                    >
                                                        {
                                                            message.pending
                                                                .errorMessage
                                                        }
                                                    </Text>
                                                    <Action
                                                        // 저장 여부를 확인하지 못했으면 한 번 더 누를 때 확인 없이 보내요(#139).
                                                        label={message.pending.unconfirmed ? '그래도 다시 보내기' : '다시 시도'}
                                                        onPress={() => {
                                                            if (
                                                                message.pending
                                                            ) {
                                                                followBottom.current = true;
                                                                nearBottom.current = true;
                                                                setNewMessages(false);
                                                                controller.retrySend(message.pending);
                                                                scheduleLatest();
                                                            }
                                                        }}
                                                    />
                                                </View>
                                            )}
                                    </View>
                                </View>
                            )}
                        </View>
                    );
                })}
            {controller.aiPending > 0 && (
                <View
                    style={styles.aiStatus}
                    accessibilityLiveRegion="polite"
                >
                    <ActivityIndicator
                        size="small"
                        color={MINT}
                    />
                    <Text style={styles.aiText}>
                        {isMockMode() ? '@링크로가 답변을 작성하고 있어요…' : '링크로가 답변 중...'}
                    </Text>
                </View>
            )}
            </ScrollView>
            {newMessages && (
                <Pressable style={styles.newMessagePill} onPress={jumpToLatest} accessibilityRole="button"
                    accessibilityLabel="새 메시지, 아래로 이동" accessibilityLiveRegion="polite">
                    <View style={styles.aiAvatar}><Text style={styles.aiAvatarText}>LR</Text></View>
                    <Text style={styles.newMessageTitle}>새 메시지</Text>
                    <Text style={styles.newMessagePreview} numberOfLines={1}>{latestPreview}</Text>
                    <View style={styles.newMessageArrow}><Text style={styles.newMessageArrowText}>↓</Text></View>
                </Pressable>
            )}
            </View>

            <View style={styles.composer}>
                <Text style={styles.body}>
                    @링크로를 불러 질문해요
                </Text>

                <View style={styles.inputRow}>
                    <Pressable onPress={addMention} disabled={controller.blocked} accessibilityRole="button"
                        accessibilityLabel="링크로 부르기" accessibilityState={{ selected: mentioned, disabled: controller.blocked }}
                        style={[styles.mentionButton, mentioned && styles.mentionButtonOn]}>
                        <Text style={[styles.mentionText, mentioned && styles.mineText]}>@</Text>
                    </Pressable>
                    <TextInput
                        ref={input}
                        style={[styles.input, inputFocused && styles.inputFocused, mentioned && styles.mentionInput]}
                        multiline
                        numberOfLines={1}
                        submitBehavior={Platform.OS === 'web' ? 'newline' : 'submit'}
                        onSubmitEditing={event => {
                            if (Platform.OS === 'web') return;
                            const native = event.nativeEvent as { text?: string; isComposing?: boolean; keyCode?: number };
                            if (native.isComposing || native.keyCode === 229) return;
                            // 최종 조합 글자는 submit 이벤트의 원문을 draftRef에 반영한 뒤 보내요.
                            if (controller.canSend) sendDraft(native.text);
                        }}
                        placeholder="메시지를 입력해요"
                        placeholderTextColor={SECONDARY}
                        accessibilityLabel="채팅 메시지"
                        value={controller.draft}
                        onChangeText={controller.setDraft}
                        onFocus={() => { setInputFocused(true); onInputFocus?.(); }}
                        onBlur={() => setInputFocused(false)}
                        onKeyPress={event => {
                            // 웹: Enter 전송, Shift+Enter 줄바꿈 (한글 조합 중 Enter는 전송하지 않음)
                            // 모바일 Enter는 onSubmitEditing에서만 처리해 중복 전송을 막아요.
                            if (Platform.OS !== 'web') return;
                            const key = event as unknown as {
                                key?: string;
                                shiftKey?: boolean;
                                preventDefault?: () => void;
                                nativeEvent: { isComposing?: boolean; keyCode?: number };
                            };
                            if (key.key !== 'Enter' || key.shiftKey) return;
                            if (key.nativeEvent.isComposing || key.nativeEvent.keyCode === 229) return;
                            key.preventDefault?.();
                            if (controller.canSend) sendDraft();
                        }}
                        editable={!controller.blocked}
                    />
                    <Pressable
                        onPress={() => sendDraft()}
                        disabled={!controller.canSend}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !controller.canSend }}
                        style={({ pressed }) => [
                            styles.sendButton,
                            !controller.canSend && styles.sendButtonDisabled,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text style={styles.sendButtonText}>전송</Text>
                    </Pressable>
                </View>

                <Text
                    style={[
                        styles.counter,
                        controller.length > 1000 &&
                        styles.errorText,
                    ]}
                >
                    {controller.length.toLocaleString()} / 1,000
                </Text>

                {(controller.inputError ||
                    controller.length > 1000) && (
                    <Text
                        style={styles.errorText}
                        accessibilityLiveRegion="polite"
                    >
                        {controller.inputError ??
                            '메시지는 1,000자까지 입력해 주세요.'}
                    </Text>
                )}
            </View>
        </View>
    );
}

function Action({
                    label,
                    onPress,
                    disabled,
                    primary,
                }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    primary?: boolean;
}) {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!disabled }}
            style={({ pressed }) => [
                styles.button,
                primary && styles.primary,
                disabled && styles.disabled,
                pressed && styles.pressed,
            ]}
        >
            <Text
                style={[
                    styles.buttonText,
                    primary && styles.mineText,
                ]}
            >
                {label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    emphasis: { color: '#5C3F78', fontWeight: '700', textDecorationLine: 'underline', textDecorationColor: '#B79FD0' },
    listFrame: { position: 'relative', minHeight: 140 },
    newMessagePill: { position: 'absolute', left: 4, right: 4, bottom: 8, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 7, borderRadius: 24, borderWidth: 1, borderColor: '#D9CCE4', backgroundColor: '#FFFFFF', boxShadow: '0 3px 8px rgba(92,63,120,0.14)' },
    newMessageTitle: { color: MINT, fontSize: 12, fontWeight: '700' },
    newMessagePreview: { flex: 1, minWidth: 0, color: SECONDARY, fontSize: 12 },
    newMessageArrow: { width: 30, height: 30, borderRadius: 15, backgroundColor: MINT, alignItems: 'center', justifyContent: 'center' },
    newMessageArrowText: { color: '#FFFFFF', fontSize: 20, lineHeight: 24, fontWeight: '700' },
    mentionButton: { width: 50, height: 50, borderRadius: 16, backgroundColor: '#EDE8F3', alignItems: 'center', justifyContent: 'center' },
    mentionButtonOn: { backgroundColor: MINT },
    mentionText: { color: MINT, fontSize: 23, fontWeight: '700' },
    mentionInput: { color: MINT },
    messageBody: { flexShrink: 1, minWidth: 0, alignItems: 'flex-start', gap: 5 },
    mineBody: { alignItems: 'flex-end' },
    aiAvatar: { width: 26, height: 26, borderRadius: 8, backgroundColor: MINT, alignItems: 'center', justifyContent: 'center' },
    aiAvatarText: { color: '#fff', fontSize: 10, fontWeight: '800' },
    aiName: { color: MINT },
    panel: {
        padding: 10,
        gap: 10,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#EEEAF2',
        backgroundColor: '#fff',
    },
    list: {
        flexShrink: 0,
    },
    fillList: {
        flex: 1,
        flexShrink: 1,
        minHeight: 0,
    },
    listContent: {
        flexGrow: 1,
        gap: 12,
        paddingBottom: 16,
    },
    history: {
        alignItems: 'center',
        gap: 8,
    },
    empty: {
        minHeight: 190,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        gap: 14,
    },
    emptyTitle: {
        color: NAVY,
        fontSize: 17,
        fontWeight: '700',
    },
    body: {
        color: SECONDARY,
        fontSize: 12,
        lineHeight: 20,
    },
    day: {
        alignSelf: 'center',
        backgroundColor: '#F1EEF4',
        borderRadius: 12,
        overflow: 'hidden',
        paddingHorizontal: 10,
        paddingVertical: 4,
        color: SECONDARY,
        textAlign: 'center',
        fontSize: 12,
        marginVertical: 8,
    },
    system: {
        alignSelf: 'center',
        backgroundColor: '#EFEBF3',
        borderRadius: 12,
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 4,
        paddingVertical: 5,
        paddingHorizontal: 12,
    },
    systemText: {
        color: '#6F6B78',
        fontSize: 12.5,
        lineHeight: 18,
        textAlign: 'center',
    },
    message: {
        alignItems: 'flex-start',
        alignSelf: 'flex-start',
        maxWidth: '84%',
        flexDirection: 'row',
        columnGap: 7,
        gap: 5,
    },
    mine: {
        alignItems: 'flex-end',
        alignSelf: 'flex-end',
    },
    meta: {
        color: SECONDARY,
        fontSize: 11.5,
        lineHeight: 17,
    },
    bubble: {
        padding: 12,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#EEEAF2',
        borderRadius: 16,
        borderTopLeftRadius: 4,
        flexShrink: 1,
    },
    mineBubble: {
        backgroundColor: MINT,
        borderColor: MINT,
        borderTopLeftRadius: 16,
        borderBottomRightRadius: 4,
    },
    aiBubble: {
        backgroundColor: '#EDE8F3',
        borderColor: '#EDE8F3',
    },
    messageText: {
        color: NAVY,
        fontSize: 14,
        lineHeight: 22,
        flexShrink: 1,
    },
    mineText: {
        color: '#fff',
    },
    failure: {
        alignItems: 'flex-end',
        gap: 6,
    },
    errorText: {
        color: '#a13131',
        fontSize: 12,
        lineHeight: 19,
    },
    errorBox: {
        backgroundColor: '#fff1f0',
        padding: 12,
        borderRadius: 12,
        gap: 8,
    },
    aiStatus: {
        backgroundColor: '#EDE8F3',
        borderRadius: 10,
        padding: 10,
        gap: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    aiText: {
        color: MINT,
        fontSize: 12,
        lineHeight: 20,
        flex: 1,
    },
    composer: {
        flexShrink: 0,
        borderTopWidth: 1,
        borderTopColor: '#EEEAF2',
        paddingTop: 12,
        rowGap: 0,
    },
    inputRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
    },
    input: {
        ...Platform.select({ web: { outlineStyle: 'none' } as object }),
        flex: 1,
        minHeight: 50,
        maxHeight: 120,
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderWidth: 1,
        borderColor: '#EEEAF2',
        borderRadius: 16,
        backgroundColor: '#F4F1F7',
        color: NAVY,
        fontSize: 15,
        lineHeight: 22,
        textAlignVertical: 'center',
    },
    inputFocused: { borderWidth: 1.5, borderColor: MINT },
    counter: {
        marginTop: 6,
        color: '#A8A3B0',
        textAlign: 'right',
        fontSize: 11.5,
    },
    sendButton: {
        height: 50,
        minWidth: 58,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: MINT,
    },
    sendButtonDisabled: { backgroundColor: '#CFC6DA' },
    sendButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    button: {
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#EEEAF2',
        backgroundColor: '#fff',
        paddingVertical: 10,
        paddingHorizontal: 13,
    },
    buttonText: {
        color: NAVY,
        fontSize: 12,
        fontWeight: '700',
    },
    primary: {
        backgroundColor: MINT,
        borderColor: MINT,
    },
    disabled: {
        opacity: 0.45,
    },
    pressed: {
        opacity: 0.75,
    },
});
