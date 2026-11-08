/**
 * #53 방 나가기 후 mock 메모리 상태 변경 알림이에요.
 *
 * room·chat·recommendation 서비스가 서로 직접 import하지 않고
 * 방 삭제와 멤버 퇴장을 반영하도록 사용해요.
 *
 * 실제 WebSocket·STOMP 이벤트는 이번 범위 밖이에요.
 */
export type RoomMockChange = {
    roomId: string;
    leftUserId: string;
    roomDeleted: boolean;
    newOwnerId: string | null;
};

type Listener = (change: RoomMockChange) => void;

const listeners = new Set<Listener>();

export function subscribeRoomMockChanges(listener: Listener) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

export function emitRoomMockChange(change: RoomMockChange) {
    // 알림 처리 중 구독 목록이 바뀌어도 현재 알림 대상은 유지해요.
    for (const listener of [...listeners]) {
        try {
            listener(change);
        } catch (error) {
            // 알림 처리 실패가 이미 완료된 나가기를 실패로 바꾸지 않게 해요.
            // 다른 서비스의 메모리 정리도 계속 진행해요.
            console.warn(
                '방 mock 상태 변경 알림을 처리하지 못했어요.',
                error,
            );
        }
    }
}