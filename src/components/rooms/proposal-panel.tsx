import { formatStationName } from '@/utils/station-name';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { openStationPicker, type Station } from '@/app/station-search';
import { ApiError, isAuthError } from '@/services/api/errors';
import { createProposal, deleteProposal, voteProposal } from '@/services/room';
import { UNKNOWN_PROPOSER_NAME } from '@/services/room-proposals';
import { RoomError, type RoomStation, type StationProposal, type StationProposalList } from '@/types/room';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const MINT_DEEP = '#12a77a';
const MINT_SOFT = '#e6f8f1';
const WHITE = '#ffffff';
const BG = '#f3f5f8';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const RED = '#d6455d';
const ORANGE = '#c77a00';

export type ProposalState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; list: StationProposalList };

type Props = {
    roomId: string;
    roomName: string;
    isOwner: boolean;
    myUserId: string;
    /** 투표 참여 인원 표시용 (N/M명 참여) */
    memberCount: number;
    state: ProposalState;
    /** 7.15 재조회 */
    onReload: () => Promise<void>;
    /** 그림 35 ❾ 약속역으로 확정 (OWNER, 7.10). 투표 결과와 무관하게 방장이 직접 눌러야 확정돼요 */
    onConfirm: (station: RoomStation) => void;
    confirmBusy: boolean;
    onOpenRecommendations: () => void;
    /** 화면 확인용: 첫 제안·첫 투표를 실패시킵니다 (다시 시도하면 성공) */
    mockProposeError?: boolean;
    mockVoteError?: boolean;
};

type Dialog = { kind: 'vote' | 'delete'; proposal: StationProposal } | null;
type Notice = { tone: 'info' | 'error'; text: string } | null;

/**
 * 약속역 후보 · 투표 패널 (#50, 설계서 그림 35·38·39, 명세 7.14~7.17)
 *
 * - 후보마다 역·노선·제안자·득표 수·내 투표 여부를 보여주고, 득표순으로 정렬해요 (명세: 정렬은 프론트)
 * - 1인 1표(방 전체). 투표 전 확인 시트를 거치고, 투표 후에는 다른 후보를 누를 수 없어요 (변경·취소 불가)
 * - 삭제는 제안자 본인 또는 OWNER 만. 삭제 확인 시트에서 함께 사라지는 표를 알려줘요
 *   내가 투표한 후보가 지워지면 다시 투표할 수 있어요 (7.17)
 * - 직접 제안은 공통 역 검색 화면(#33, purpose: proposal). 미제공 역은 역 검색 화면이 먼저 막고,
 *   서버(mock)도 STATION_UNSUPPORTED 로 한 번 더 거절해요
 * - 최다 득표 후보도 자동으로 확정하지 않아요. 확정은 OWNER 가 "약속역으로 확정"을 눌러야 해요
 * - 서버 모드(#101)는 7.14~7.17 을 불러요. 제안·투표·삭제 뒤에는 부모의 7.15 재조회로 서버 목록에 맞춰요
 * - 서버 station 에는 lines 가 없어 노선 배지가 비어 보여요. 제안자 닉네임이 비면 "알 수 없음"이에요
 * - 실시간 STATION_PROPOSAL_* 수신 시 7.15 재조회는 #117 에서 구현했어요(부모 rooms/[roomId].tsx 의 useRoomEvents)
 * TODO: 동시성(ROOM_BUSY) 자동 재시도 정책은 없어요. 지금은 안내 문구로 다시 시도를 부탁해요 (이슈 미정)
 */
export default function ProposalPanel({
    roomId,
    roomName,
    isOwner,
    myUserId,
    memberCount,
    state,
    onReload,
    onConfirm,
    confirmBusy,
    onOpenRecommendations,
    mockProposeError,
    mockVoteError,
}: Props) {
    const [dialog, setDialog] = useState<Dialog>(null);
    const [working, setWorking] = useState(false);
    const [proposing, setProposing] = useState<Station | null>(null);
    const [notice, setNotice] = useState<Notice>(null);
    const proposeFailNext = useRef(!!mockProposeError);
    const voteFailNext = useRef(!!mockVoteError);

    const list = state.status === 'ready' ? state.list : null;
    const items = useMemo(
        () =>
            [...(list?.items ?? [])].sort(
                (a, b) => b.voteCount - a.voteCount || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            ),
        [list],
    );
    const max = list?.maxProposals ?? 9;
    const full = items.length >= max;
    const myVote = items.find(item => item.votedByMe) ?? null;
    const totalVotes = items.reduce((sum, item) => sum + item.voteCount, 0);
    const topVotes = items[0]?.voteCount ?? 0;

    const fail = (error: unknown, fallback: string) => {
        // 인증 오류는 A-1 공통 처리에 맡기고 패널에서 중복 안내하지 않아요.
        if (error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
        const message = error instanceof RoomError ? error.message : fallback;
        setNotice({ tone: 'error', text: message });
        // 목록이 바뀌었을 수 있는 오류는 서버 목록(7.15)을 다시 불러와 맞춰요.
        // 방 접근 불가(403·404)는 재조회에서 방 상세의 접근 불가 화면으로 넘어가요. 응답 형식 오류는 제안이 저장됐을 수 있어 다시 맞춰요.
        if (error instanceof RoomError && ['ALREADY_VOTED', 'ALREADY_PROPOSED', 'PROPOSAL_NOT_FOUND', 'PROPOSAL_LIMIT_EXCEEDED',
            'NOT_PROPOSAL_OWNER', 'NOT_ROOM_MEMBER', 'ROOM_NOT_FOUND', 'UNKNOWN_ERROR'].includes(error.code)) {
            onReload();
        }
    };

    /* ───────── 직접 제안 (역 검색 → 7.14) ───────── */
    const submitProposal = async (station: Station) => {
        setNotice(null);
        // 명세 7.14: 중복·미제공·상한은 서버가 최종 판단, 프론트 사전 차단은 UX 용
        if (items.some(item => item.station.id === station.id)) {
            setNotice({ tone: 'error', text: `${formatStationName(station.name)}은 이미 후보에 있어요. 목록에서 투표해 주세요.` });
            return;
        }
        setProposing(station);
        try {
            const failNow = proposeFailNext.current;
            proposeFailNext.current = false; // 다시 시도하면 성공하도록
            await createProposal(roomId, station.id, undefined, failNow ? 'error' : undefined);
            await onReload();
            setNotice({ tone: 'info', text: `${formatStationName(station.name)}을 약속역 후보로 제안했어요.` });
        } catch (error) {
            fail(error, '후보를 제안하지 못했어요. 다시 시도해 주세요.');
        } finally {
            setProposing(null);
        }
    };

    const pickStation = () => {
        if (full || proposing) return;
        openStationPicker({ purpose: 'proposal', contextLabel: roomName }, submitProposal);
    };

    /* ───────── 투표 · 삭제 (확인 시트) ───────── */
    const runDialog = async () => {
        if (!dialog) return;
        const { kind, proposal } = dialog;
        setWorking(true);
        setNotice(null);
        try {
            if (kind === 'vote') {
                const failNow = voteFailNext.current;
                voteFailNext.current = false;
                await voteProposal(roomId, proposal.id, failNow ? 'error' : undefined);
                await onReload();
                setNotice({ tone: 'info', text: `${formatStationName(proposal.station.name)}에 투표했어요. 결과는 참고용이에요.` });
            } else {
                await deleteProposal(roomId, proposal.id);
                await onReload();
                setNotice({
                    tone: 'info',
                    text: proposal.votedByMe
                        ? `${formatStationName(proposal.station.name)} 후보를 삭제했어요. 내 표도 사라져 다른 후보에 다시 투표할 수 있어요.`
                        : `${formatStationName(proposal.station.name)} 후보를 삭제했어요.`,
                });
            }
            setDialog(null);
        } catch (error) {
            setDialog(null);
            fail(error, kind === 'vote' ? '투표하지 못했어요. 다시 시도해 주세요.' : '후보를 삭제하지 못했어요. 다시 시도해 주세요.');
        } finally {
            setWorking(false);
        }
    };

    /* ───────── 렌더 ───────── */

    if (state.status === 'loading') {
        return (
            <View style={styles.panel}>
                <View style={styles.stateBox}>
                    <ActivityIndicator color={NAVY} />
                    <Text style={styles.stateText}>약속역 후보를 불러오고 있어요</Text>
                </View>
            </View>
        );
    }

    if (state.status === 'error') {
        return (
            <View style={styles.panel}>
                <View style={styles.stateBox}>
                    <Ionicons name="cloud-offline-outline" size={28} color={RED} />
                    <Text style={styles.stateTitle}>약속역 후보를 불러오지 못했어요</Text>
                    <Text style={styles.stateText}>{state.message}</Text>
                    <Pressable style={styles.retryButton} onPress={onReload} accessibilityRole="button">
                        <Ionicons name="refresh" size={16} color={WHITE} />
                        <Text style={styles.retryText}>다시 시도</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.panel}>
            <View style={styles.rowBetween}>
                <Text style={styles.title}>약속역 후보</Text>
                <Text style={[styles.counter, full && styles.counterFull]}>{items.length}/{max}</Text>
            </View>

            {items.length === 0 ? (
                <View style={styles.emptyBox}>
                    <View style={styles.emptyIcon}><Ionicons name="flag-outline" size={24} color={SECONDARY} /></View>
                    <Text style={styles.stateTitle}>아직 약속역 후보가 없어요</Text>
                    <Text style={styles.stateText}>중간역을 추천받거나 역을 검색해서 직접 제안해 보세요.</Text>
                </View>
            ) : (
                /* 그림 35 ❼ 후보 투표 */
                <View style={styles.voteBox}>
                    <View style={styles.rowBetween}>
                        <Text style={styles.voteTitle}>후보 투표</Text>
                        <Text style={styles.voteCount}>{totalVotes}/{memberCount}명 참여</Text>
                    </View>

                    {items.map(item => {
                        const canDelete = isOwner || item.proposedBy.userId === myUserId;
                        const lead = topVotes > 0 && item.voteCount === topVotes;
                        // 막대 = 득표 / 방 인원 (그림 35: 4명 중 3표 → 75%)
                        const ratio = memberCount > 0 ? Math.min(1, item.voteCount / memberCount) : 0;
                        const votable = !myVote;
                        return (
                            <View key={item.id} style={[styles.item, item.isSelected && styles.itemSelected]}>
                                <Pressable
                                    style={({ pressed }) => [styles.itemMain, pressed && votable && styles.pressed]}
                                    onPress={() => votable && setDialog({ kind: 'vote', proposal: item })}
                                    disabled={!votable || working}
                                    accessibilityRole="button"
                                    accessibilityState={{ disabled: !votable, selected: item.votedByMe }}
                                    accessibilityLabel={`${formatStationName(item.station.name)} ${item.voteCount}표${item.votedByMe ? ', 내가 투표함' : votable ? ', 눌러서 투표' : ''}`}
                                >
                                    <View style={[styles.mark, item.votedByMe && styles.markOn, !votable && !item.votedByMe && styles.markOff]}>
                                        {item.votedByMe && <Ionicons name="checkmark" size={14} color={WHITE} />}
                                    </View>
                                    <View style={styles.itemBody}>
                                        <View style={styles.nameRow}>
                                            <Text style={styles.name} numberOfLines={1}>{formatStationName(item.station.name)}</Text>
                                            {item.station.lines?.map(line => (
                                                <View key={line.lineId} style={[styles.lineDot, { backgroundColor: line.color }]}>
                                                    <Text style={styles.lineDotText}>{line.lineName.replace('호선', '')}</Text>
                                                </View>
                                            ))}
                                            {item.isSelected && <Text style={styles.selectedTag}>확정</Text>}
                                        </View>
                                        <View style={styles.barRow}>
                                            <View style={styles.bar}>
                                                <View style={[styles.barFill, lead && styles.barLead, { width: `${Math.round(ratio * 100)}%` }]} />
                                            </View>
                                            <Text style={styles.votes}>{item.voteCount}표</Text>
                                        </View>
                                    </View>
                                </Pressable>

                                <Text style={styles.meta} numberOfLines={1}>
                                    {item.proposedBy.userId === myUserId
                                        ? '내가 제안'
                                        : item.proposedBy.nickname === UNKNOWN_PROPOSER_NAME ? `${UNKNOWN_PROPOSER_NAME} 제안` : `${item.proposedBy.nickname}님 제안`}
                                    {item.resultId ? ' · 추천 결과에서' : ''}
                                </Text>
                                {(canDelete || (isOwner && !item.isSelected)) && (
                                    <View style={styles.actions}>
                                        {canDelete && (
                                            <Pressable
                                                style={styles.deleteButton}
                                                onPress={() => setDialog({ kind: 'delete', proposal: item })}
                                                disabled={working}
                                                accessibilityRole="button"
                                                accessibilityLabel={`${formatStationName(item.station.name)} 후보 삭제`}
                                            >
                                                <Text style={styles.deleteText}>후보 삭제</Text>
                                            </Pressable>
                                        )}
                                        {isOwner && !item.isSelected && (
                                            <Pressable
                                                style={[styles.confirmButton, confirmBusy && styles.disabled]}
                                                onPress={() => onConfirm(item.station)}
                                                disabled={confirmBusy}
                                                accessibilityRole="button"
                                            >
                                                <Text style={styles.confirmText}>약속역으로 확정</Text>
                                            </Pressable>
                                        )}
                                    </View>
                                )}
                            </View>
                        );
                    })}

                    <Text style={styles.voteHint}>
                        {myVote
                            ? '투표를 마쳤어요. 변경·취소할 수 없고 결과는 참고용이에요'
                            : '후보를 눌러 투표해요. 1인 1표이고 투표 후에는 바꾸거나 취소할 수 없어요'}
                    </Text>
                </View>
            )}

            {/* 그림 39 ❹ / 그림 38 ❹ 권한 안내 */}
            <Text style={styles.roleHint}>
                {isOwner
                    ? '투표는 참고용이에요. 가장 많이 받은 후보도 자동으로 확정되지 않으니, 방장이 직접 확정해 주세요.'
                    : '방장이 최종 확정할 수 있어요. 내가 제안한 후보만 삭제할 수 있어요.'}
            </Text>

            {/* 후보 제안 */}
            <View style={styles.proposeRow}>
                <Pressable
                    style={({ pressed }) => [styles.proposeButton, (full || !!proposing) && styles.disabled, pressed && styles.pressed]}
                    onPress={pickStation}
                    disabled={full || !!proposing}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: full || !!proposing }}
                >
                    {proposing ? <ActivityIndicator size="small" color={NAVY} /> : <Ionicons name="search" size={16} color={NAVY} />}
                    <Text style={styles.proposeText}>{proposing ? `${formatStationName(proposing.name)} 제안 중` : '역 검색해서 제안'}</Text>
                </Pressable>
                <Pressable style={({ pressed }) => [styles.recommendButton, pressed && styles.pressed]} onPress={onOpenRecommendations} accessibilityRole="button">
                    <Ionicons name="sparkles" size={15} color={WHITE} />
                    <Text style={styles.recommendText}>추천받고 제안</Text>
                </Pressable>
            </View>
            {full && (
                <View style={styles.warnBox}>
                    <Ionicons name="alert-circle-outline" size={16} color={ORANGE} />
                    <Text style={styles.warnText}>후보는 방당 {max}개까지예요. 후보를 지운 뒤 새로 제안할 수 있어요.</Text>
                </View>
            )}

            {notice && (
                <View style={[styles.notice, notice.tone === 'error' && styles.noticeError]}>
                    <Ionicons
                        name={notice.tone === 'error' ? 'warning-outline' : 'checkmark-circle-outline'}
                        size={17}
                        color={notice.tone === 'error' ? RED : MINT_DEEP}
                    />
                    <Text style={[styles.noticeText, notice.tone === 'error' && styles.noticeTextError]}>{notice.text}</Text>
                </View>
            )}

            {/* 투표 · 삭제 확인 시트 */}
            <Modal transparent animationType="fade" visible={!!dialog} onRequestClose={() => !working && setDialog(null)}>
                <View style={styles.backdrop}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => !working && setDialog(null)} accessibilityLabel="닫기" />
                    {dialog && (
                        <View style={styles.sheet}>
                            <View style={styles.grabber} />
                            <View style={[styles.sheetIcon, dialog.kind === 'delete' && styles.sheetIconDanger]}>
                                <Ionicons name={dialog.kind === 'vote' ? 'checkbox-outline' : 'trash-outline'} size={22} color={dialog.kind === 'vote' ? MINT_DEEP : RED} />
                            </View>
                            <Text style={styles.sheetTitle}>
                                {dialog.kind === 'vote' ? `${formatStationName(dialog.proposal.station.name)}에 투표할까요?` : `${formatStationName(dialog.proposal.station.name)} 후보를 삭제할까요?`}
                            </Text>
                            <Text style={styles.sheetBody}>{dialogBody(dialog)}</Text>
                            <View style={styles.sheetActions}>
                                <Pressable style={styles.sheetCancel} onPress={() => setDialog(null)} disabled={working} accessibilityRole="button">
                                    <Text style={styles.sheetCancelText}>취소</Text>
                                </Pressable>
                                <Pressable
                                    style={[styles.sheetPrimary, dialog.kind === 'delete' && styles.sheetDanger]}
                                    onPress={runDialog}
                                    disabled={working}
                                    accessibilityRole="button"
                                >
                                    {working ? <ActivityIndicator color={WHITE} /> : (
                                        <Text style={styles.sheetPrimaryText}>{dialog.kind === 'vote' ? '투표하기' : '삭제'}</Text>
                                    )}
                                </Pressable>
                            </View>
                        </View>
                    )}
                </View>
            </Modal>
        </View>
    );
}

function dialogBody(dialog: NonNullable<Dialog>) {
    const { proposal } = dialog;
    if (dialog.kind === 'vote') {
        return '1인 1표예요. 투표하면 다른 후보로 바꾸거나 취소할 수 없어요. 투표 결과는 참고용이고, 약속역은 방장이 확정해요.';
    }
    const parts: string[] = [];
    if (proposal.voteCount > 0) {
        parts.push(`이 후보에 들어간 ${proposal.voteCount}표도 함께 사라져요.`);
        if (proposal.votedByMe) parts.push('내 표도 사라지니 다른 후보에 다시 투표할 수 있어요.');
    } else {
        parts.push('아직 받은 표가 없는 후보예요.');
    }
    if (proposal.isSelected) parts.push('이미 확정된 약속역은 그대로 유지돼요.');
    return parts.join(' ');
}

const styles = StyleSheet.create({
    panel: { marginTop: 12, padding: 16, borderRadius: 20, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, gap: 12 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    title: { fontSize: 16, fontWeight: '800', color: NAVY, letterSpacing: -0.3 },
    counter: { fontSize: 13, fontWeight: '800', color: SECONDARY },
    counterFull: { color: ORANGE },
    pressed: { opacity: 0.8 },
    disabled: { opacity: 0.45 },

    stateBox: { alignItems: 'center', paddingVertical: 28, gap: 8 },
    stateTitle: { fontSize: 15, fontWeight: '800', color: NAVY, textAlign: 'center' },
    stateText: { fontSize: 12.5, lineHeight: 18, fontWeight: '500', color: SECONDARY, textAlign: 'center' },
    retryButton: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: 18, borderRadius: 12, backgroundColor: NAVY },
    retryText: { fontSize: 14, fontWeight: '800', color: WHITE },

    emptyBox: { alignItems: 'center', paddingVertical: 20, gap: 6, borderRadius: 16, backgroundColor: BG },
    emptyIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },

    voteBox: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#cdeee1', backgroundColor: '#f4fcf8', gap: 10 },
    voteTitle: { fontSize: 15, fontWeight: '800', color: NAVY },
    voteCount: { fontSize: 13, fontWeight: '800', color: MINT_DEEP },
    item: { padding: 12, borderRadius: 14, backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, gap: 8 },
    itemSelected: { borderColor: MINT, borderWidth: 1.5 },
    itemMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    mark: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#c0c6d1', alignItems: 'center', justifyContent: 'center' },
    markOn: { backgroundColor: MINT_DEEP, borderColor: MINT_DEEP },
    markOff: { borderColor: '#e1e5ec', backgroundColor: '#f6f7f9' },
    itemBody: { flex: 1, gap: 7 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    name: { fontSize: 15, fontWeight: '800', color: NAVY, flexShrink: 1 },
    lineDot: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    lineDotText: { fontSize: 10, fontWeight: '800', color: WHITE },
    selectedTag: { fontSize: 10.5, fontWeight: '800', color: MINT_DEEP, backgroundColor: MINT_SOFT, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    bar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#e8ebf0', overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4, backgroundColor: '#b4bccb' },
    barLead: { backgroundColor: MINT_DEEP },
    votes: { width: 34, textAlign: 'right', fontSize: 14, fontWeight: '800', color: NAVY },
    meta: { marginLeft: 34, fontSize: 12, fontWeight: '600', color: SECONDARY },
    actions: { marginLeft: 34, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
    deleteButton: { height: 30, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: BORDER, backgroundColor: WHITE, justifyContent: 'center' },
    deleteText: { fontSize: 12, fontWeight: '700', color: SECONDARY },
    confirmButton: { height: 30, paddingHorizontal: 10, borderRadius: 9, backgroundColor: NAVY, justifyContent: 'center' },
    confirmText: { fontSize: 12, fontWeight: '800', color: WHITE },
    voteHint: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: SECONDARY },
    roleHint: { fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: SECONDARY },

    proposeRow: { flexDirection: 'row', gap: 8 },
    proposeButton: { flex: 1, height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: NAVY, backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    proposeText: { fontSize: 14, fontWeight: '800', color: NAVY },
    recommendButton: { flex: 1, height: 46, borderRadius: 14, backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    recommendText: { fontSize: 14, fontWeight: '800', color: WHITE },
    warnBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 11, borderRadius: 12, backgroundColor: '#fff4e0' },
    warnText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: '#7a4e00' },
    notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 11, borderRadius: 12, backgroundColor: MINT_SOFT },
    noticeError: { backgroundColor: '#fdecef' },
    noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: '#0b6b4e' },
    noticeTextError: { color: RED },

    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,28,63,0.42)' },
    sheet: { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 30, gap: 12 },
    grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#d9dde4', alignSelf: 'center', marginBottom: 6 },
    sheetIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: MINT_SOFT, alignItems: 'center', justifyContent: 'center' },
    sheetIconDanger: { backgroundColor: '#fdecef' },
    sheetTitle: { fontSize: 18, fontWeight: '800', color: NAVY, letterSpacing: -0.3 },
    sheetBody: { fontSize: 13.5, lineHeight: 20, fontWeight: '500', color: SECONDARY },
    sheetActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
    sheetCancel: { flex: 1, height: 52, borderRadius: 16, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
    sheetCancelText: { fontSize: 15, fontWeight: '700', color: NAVY },
    sheetPrimary: { flex: 1.4, height: 52, borderRadius: 16, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
    sheetDanger: { backgroundColor: RED },
    sheetPrimaryText: { fontSize: 15, fontWeight: '800', color: WHITE },
});
