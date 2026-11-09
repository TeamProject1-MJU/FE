import { useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
    ActivityIndicator,
    Keyboard,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import type { useRoomChat } from '@/hooks/use-room-chat';
import { toChatDisplayContent } from '@/services/chat';
import type { PendingChatMessage } from '@/types/chat';
import type { RoomMember } from '@/types/room';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const SECONDARY = '#6b7488';

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
                                          onInputFocus,
                                      }: {
    controller: ReturnType<typeof useRoomChat>;
    myUserId: string;
    members: RoomMember[];
    onInputFocus?: () => void;
}) {
    const list = useRef<ScrollView>(null);
    const input = useRef<TextInput>(null);
    const nearBottom = useRef(true);
    const lastContent = useRef('');
    const lastPending = useRef('');
    const contentHeight = useRef(0);
    const scrollOffset = useRef(0);
    const anchor = useRef<{
        height: number;
        offset: number;
    } | null>(null);

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
                members.find(
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
                        ? '@링크로'
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

    const jumpToLatest = () => {
        nearBottom.current = true;
        setNewMessages(false);
        list.current?.scrollToEnd({ animated: true });
    };

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
            <View style={styles.panel}>
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

    return (
        <View style={styles.panel}>
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

            <ScrollView
                ref={list}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                maintainVisibleContentPosition={{
                    minIndexForVisible: 1,
                }}
                scrollEventThrottle={32}
                onScroll={({ nativeEvent }) => {
                    scrollOffset.current =
                        nativeEvent.contentOffset.y;

                    nearBottom.current =
                        nativeEvent.contentSize.height -
                        nativeEvent.layoutMeasurement.height -
                        nativeEvent.contentOffset.y <
                        60;

                    if (nearBottom.current) {
                        setNewMessages(false);
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

                    const latest =
                        controller.messages.at(-1)?.id ?? '';
                    const queued = controller.pending
                        .map(message => `${message.clientId}:${message.status}`)
                        .join('|');

                    const changed =
                        latest !== lastContent.current ||
                        queued !== lastPending.current;
                    const sentByMe =
                        !!queued && queued !== lastPending.current;

                    if (
                        changed &&
                        (nearBottom.current || sentByMe)
                    ) {
                        list.current?.scrollToEnd({
                            animated: false,
                        });
                    } else if (changed) {
                        setNewMessages(true);
                    }

                    lastContent.current = latest;
                    lastPending.current = queued;
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
                                    <Text style={styles.meta}>
                                        {dateLabel(message.createdAt)}
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
                                    <Text style={styles.meta}>
                                        {message.name} ·{' '}
                                        {dateLabel(message.createdAt)}
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
                                            {message.content}
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
                                                    label="다시 시도"
                                                    onPress={() => {
                                                        if (
                                                            message.pending
                                                        ) {
                                                            controller.retrySend(
                                                                message.pending,
                                                            );
                                                        }
                                                    }}
                                                />
                                            </View>
                                        )}
                                </View>
                            )}
                        </View>
                    );
                })}
            </ScrollView>

            {newMessages && (
                <Action
                    label="새 메시지 · 아래로 이동"
                    onPress={jumpToLatest}
                />
            )}

            {controller.aiPending > 0 && (
                <View
                    style={styles.aiStatus}
                    accessibilityLiveRegion="polite"
                >
                    <ActivityIndicator
                        size="small"
                        color="#15664e"
                    />
                    <Text style={styles.aiText}>
                        @링크로가 답변을 작성하고 있어요…
                    </Text>
                </View>
            )}

            <View style={styles.composer}>
                <Text style={styles.body}>
                    @링크로를 불러 질문해요
                </Text>

                <View style={styles.inputRow}>
                    <TextInput
                        ref={input}
                        style={styles.input}
                        multiline
                        submitBehavior="newline"
                        placeholder="메시지를 입력해요"
                        placeholderTextColor={SECONDARY}
                        accessibilityLabel="채팅 메시지"
                        value={controller.draft}
                        onChangeText={controller.setDraft}
                        onFocus={() => onInputFocus?.()}
                        onKeyPress={event => {
                            // 웹: Enter 전송, Shift+Enter 줄바꿈 (한글 조합 중 Enter는 전송하지 않음)
                            // 모바일은 키보드 Enter가 줄바꿈이고 [전송] 버튼으로 보내요.
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
                            if (controller.canSend) controller.send();
                        }}
                        editable={!controller.blocked}
                    />
                    <Action
                        label="전송"
                        onPress={controller.send}
                        disabled={!controller.canSend}
                        primary
                    />
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
    panel: {
        padding: 14,
        gap: 12,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#e6e9ef',
        backgroundColor: '#fff',
    },
    list: {
        height: 360,
    },
    listContent: {
        flexGrow: 1,
        gap: 12,
        paddingBottom: 8,
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
        color: SECONDARY,
        textAlign: 'center',
        fontSize: 12,
        marginVertical: 8,
    },
    system: {
        alignItems: 'center',
        gap: 4,
        paddingVertical: 6,
        paddingHorizontal: 12,
    },
    systemText: {
        color: SECONDARY,
        fontSize: 12,
        lineHeight: 20,
        textAlign: 'center',
    },
    message: {
        alignItems: 'flex-start',
        alignSelf: 'flex-start',
        maxWidth: '90%',
        gap: 5,
    },
    mine: {
        alignItems: 'flex-end',
        alignSelf: 'flex-end',
    },
    meta: {
        color: SECONDARY,
        fontSize: 11,
        lineHeight: 17,
    },
    bubble: {
        padding: 12,
        backgroundColor: '#f3f5f8',
        borderRadius: 14,
        flexShrink: 1,
    },
    mineBubble: {
        backgroundColor: NAVY,
    },
    aiBubble: {
        backgroundColor: '#eafaf4',
        borderLeftWidth: 3,
        borderLeftColor: MINT,
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
        backgroundColor: '#eafaf4',
        borderRadius: 10,
        padding: 10,
        gap: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    aiText: {
        color: '#15664e',
        fontSize: 12,
        lineHeight: 20,
        flex: 1,
    },
    composer: {
        borderTopWidth: 1,
        borderTopColor: '#e6e9ef',
        paddingTop: 12,
        gap: 8,
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
    },
    input: {
        flex: 1,
        minHeight: 46,
        maxHeight: 120,
        padding: 10,
        borderWidth: 1,
        borderColor: '#e6e9ef',
        borderRadius: 12,
        backgroundColor: '#f3f5f8',
        color: NAVY,
        fontSize: 16,
        lineHeight: 23,
        textAlignVertical: 'top',
    },
    counter: {
        color: SECONDARY,
        textAlign: 'right',
        fontSize: 12,
    },
    button: {
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e6e9ef',
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
        backgroundColor: NAVY,
        borderColor: NAVY,
    },
    disabled: {
        opacity: 0.45,
    },
    pressed: {
        opacity: 0.75,
    },
});