import { useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
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

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const PURPLE = '#6a5ae0';
const WHITE = '#ffffff';
const BG = '#f3f5f8';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';

type Role = 'OWNER' | 'MEMBER';
type Tab = 'chat' | 'vote' | 'members';
type Proposer = 'owner' | 'member';
type Proposal = { id: string; station: string; proposer: Proposer; baseVotes: number };
type ChatMessage = { id: string; sender: 'owner' | 'member' | 'system'; text: string };

const STATION_OPTIONS = ['서울역', '왕십리역', '홍대입구역', '강남역', '사당역', '건대입구역'];
const INITIAL_PROPOSALS: Proposal[] = [
    { id: 's1', station: '강남역', proposer: 'owner', baseVotes: 1 },
    { id: 's2', station: '사당역', proposer: 'member', baseVotes: 0 },
    { id: 's3', station: '건대입구역', proposer: 'owner', baseVotes: 1 },
];
const INITIAL_MESSAGES: ChatMessage[] = [
    { id: 'm1', sender: 'system', text: '예시 대화입니다. 실제 서버 채팅 기록이 아닙니다.' },
    { id: 'm2', sender: 'member', text: '다들 어느 역에서 출발해?' },
    { id: 'm3', sender: 'owner', text: '출발역 정하고 중간역 추천 받아보자!' },
];

export default function RoomDetailScreen() {
    const insets = useSafeAreaInsets();
    const scrollRef = useRef<ScrollView>(null);
    const { roomId, roomName, appointmentAt, maxMembers } = useLocalSearchParams<{
        roomId: string;
        roomName?: string;
        appointmentAt?: string;
        maxMembers?: string;
    }>();

    const [role, setRole] = useState<Role>('OWNER');
    const [tab, setTab] = useState<Tab>('chat');
    const [notice, setNotice] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
    const [messageInput, setMessageInput] = useState('');
    const [proposals, setProposals] = useState<Proposal[]>(INITIAL_PROPOSALS);
    const [suggestedStation, setSuggestedStation] = useState('');
    const [votes, setVotes] = useState<Record<Role, string[]>>({ OWNER: [], MEMBER: [] });
    const [selectedStation, setSelectedStation] = useState<string | null>(null);

    const isPreview = roomId === 'preview';
    const max = [2, 3, 4].includes(Number(maxMembers)) ? Number(maxMembers) : 4;
    const isOwner = role === 'OWNER';

    const back = () => router.canGoBack() ? router.back() : router.replace('/rooms');
    const showPending = (feature: string) => setNotice(`${feature}은(는) API 연동 후 이용할 수 있습니다.`);
    const addSystem = (text: string) => setMessages(previous => [
        ...previous,
        { id: `sys-${Date.now()}-${previous.length}`, sender: 'system', text },
    ]);

    const sendMessage = () => {
        const value = messageInput.trim();
        if (!value) return;
        const sender = isOwner ? 'owner' : 'member';
        setMessages(previous => [
            ...previous,
            { id: `msg-${Date.now()}-${previous.length}`, sender, text: value },
        ]);
        setMessageInput('');
        if (value.toLowerCase().includes('@linkro')) {
            setNotice('@linkro AI 멘션은 채팅·AI API 연동 후 응답합니다.');
        }
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    };

    const vote = (proposalId: string) => {
        const mine = votes[role];
        setVotes(previous => ({
            ...previous,
            [role]: mine.includes(proposalId)
                ? mine.filter(id => id !== proposalId)
                : [...mine, proposalId],
        }));
    };

    const suggest = () => {
        if (!suggestedStation) return setNotice('제안할 역을 선택해 주세요.');
        if (proposals.some(p => p.station === suggestedStation)) {
            return setNotice('같은 역은 중복으로 제안할 수 없습니다.');
        }
        if (proposals.length >= 5) return setNotice('약속역 후보는 방당 최대 5개입니다.');
        const newId = `p-${Date.now()}`;
        setProposals(current => [
            { id: newId, station: suggestedStation, proposer: isOwner ? 'owner' : 'member', baseVotes: 0 },
            ...current,
        ]);
        addSystem(`${suggestedStation} 후보가 미리보기 목록에 추가되었습니다.`);
        setSuggestedStation('');
        setNotice('후보 추가는 화면 안에서만 반영됩니다.');
    };

    const removeProposal = (proposal: Proposal) => {
        if (!isOwner && proposal.proposer !== 'member') return;
        setProposals(list => list.filter(item => item.id !== proposal.id));
        setVotes(previous => ({
            OWNER: previous.OWNER.filter(id => id !== proposal.id),
            MEMBER: previous.MEMBER.filter(id => id !== proposal.id),
        }));
        // 명세: 후보 삭제 시 이미 확정된 selectedStation은 변경되지 않습니다.
        addSystem(`${proposal.station} 후보가 미리보기 목록에서 삭제되었습니다.`);
    };

    const confirmStation = (station: string) => {
        if (!isOwner) return;
        setSelectedStation(station);
        addSystem(`방장이 최종 약속역을 ${station}(으)로 확정했습니다. (미리보기)`);
        setNotice('최종 약속역은 화면 안에서만 변경됩니다.');
    };

    if (!isPreview) {
        return (
            <View style={styles.root}>
                <StatusBar style="dark" />
                <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                    <Pressable style={styles.backButton} onPress={back}><Ionicons name="chevron-back" size={25} color={NAVY} /></Pressable>
                    <Text style={styles.headerTitle}>약속방</Text>
                    <View style={styles.backButton} />
                </View>
                <View style={styles.notConnected}>
                    <Ionicons name="cloud-offline-outline" size={42} color={SECONDARY} />
                    <Text style={styles.sectionTitle}>방 상세 API가 연결되지 않았어요</Text>
                    <Text style={styles.caption}>실제 roomId 조회는 후속 작업에서 연동합니다.</Text>
                    <Pressable style={styles.primaryButton} onPress={() => router.replace('/rooms')}>
                        <Text style={styles.primaryText}>약속방 목록으로</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.root}>
            <StatusBar style="dark" />
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <Pressable style={styles.backButton} onPress={back}><Ionicons name="chevron-back" size={25} color={NAVY} /></Pressable>
                <Text style={styles.headerTitle}>약속방 상세</Text>
                <View style={styles.backButton} />
            </View>

            <ScrollView
                ref={scrollRef}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.demoBanner}>
                    <Ionicons name="information-circle-outline" size={18} color={NAVY} />
                    <Text style={styles.demoText}>UI 체험 모드: 채팅·투표·확정은 화면에만 반영되고 서버에 저장되지 않습니다.</Text>
                </View>
                <View style={styles.roomCard}>
                    <View style={styles.roomCardTop}>
                        <Text style={styles.roomName}>{roomName || '약속방 미리보기'}</Text>
                        <View style={styles.roomStatus}>
                            <Text style={styles.roomStatusText}>{selectedStation ? 'CONFIRMED' : 'OPEN'}</Text>
                        </View>
                    </View>
                    <Text style={styles.roomInfo}>📅 {appointmentAt || '약속 시간 미설정'}</Text>
                    <Text style={styles.roomInfo}>👥 예시 참여자 {Math.min(max, 3)}/{max}명</Text>
                    <Text style={styles.roomInfo}>📍 최종 약속역: {selectedStation || '미확정'}</Text>
                </View>

                <View style={styles.roleCard}>
                    <View style={styles.roleHeading}>
                        <Text style={styles.cardTitle}>권한 UI 체험</Text>
                        <Text style={styles.roleHint}>시연용 전환</Text>
                    </View>
                    <View style={styles.roleButtons}>
                        {(['OWNER', 'MEMBER'] as const).map(item => (
                            <Pressable
                                key={item}
                                onPress={() => { setRole(item); setNotice(''); }}
                                style={[styles.roleButton, role === item && styles.roleButtonActive]}
                            >
                                <Text style={[styles.roleButtonText, role === item && styles.roleButtonTextActive]}>
                                    {item === 'OWNER' ? '방장 화면' : '일반 멤버 화면'}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                    <Text style={styles.roleInfo}>
                        {isOwner
                            ? '방장은 초대 코드 확인·방 정보 수정·최종 약속역 확정이 가능합니다.'
                            : '일반 멤버는 후보 제안·투표·채팅이 가능하지만 최종 약속역을 확정할 수 없습니다.'}
                    </Text>
                </View>

                {isOwner && (
                    <View style={styles.ownerArea}>
                        <View style={styles.rowBetween}>
                            <View>
                                <Text style={styles.cardTitle}>방장 전용 관리</Text>
                                <Text style={styles.caption}>초대 코드는 실제 서버 생성 후 발급됩니다.</Text>
                            </View>
                            <Ionicons name="shield-checkmark-outline" size={24} color={PURPLE} />
                        </View>
                        <View style={styles.ownerButtons}>
                            <Pressable style={styles.secondaryButton} onPress={() => showPending('초대 코드 조회')}>
                                <Text style={styles.secondaryButtonText}>초대 코드 확인</Text>
                            </Pressable>
                            <Pressable style={styles.secondaryButton} onPress={() => showPending('방 정보 수정')}>
                                <Text style={styles.secondaryButtonText}>방 설정</Text>
                            </Pressable>
                        </View>
                        {!!selectedStation && (
                            <Pressable
                                style={styles.clearButton}
                                onPress={() => { setSelectedStation(null); addSystem('방장이 최종 약속역을 해제했습니다. (미리보기)'); }}
                            >
                                <Text style={styles.clearText}>최종 약속역 확정 해제</Text>
                            </Pressable>
                        )}
                    </View>
                )}

                <View style={styles.tabs}>
                    {([
                        ['chat', '채팅', 'chatbubble-ellipses-outline'],
                        ['vote', '후보·투표', 'checkbox-outline'],
                        ['members', '참여자', 'people-outline'],
                    ] as const).map(([key, title, icon]) => (
                        <Pressable key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => { setTab(key); setNotice(''); }}>
                            <Ionicons name={icon} size={18} color={tab === key ? NAVY : SECONDARY} />
                            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{title}</Text>
                        </Pressable>
                    ))}
                </View>

                {tab === 'chat' && (
                    <View style={styles.panel}>
                        <Text style={styles.cardTitle}>약속방 채팅</Text>
                        <Text style={styles.caption}>@linkro를 포함한 메시지도 입력할 수 있어요. AI 응답은 연동 전입니다.</Text>
                        <View style={styles.chatList}>
                            {messages.map(message => {
                                const mine = message.sender === (isOwner ? 'owner' : 'member');
                                if (message.sender === 'system') {
                                    return <View key={message.id} style={styles.systemBubble}><Text style={styles.systemText}>{message.text}</Text></View>;
                                }
                                return (
                                    <View key={message.id} style={[styles.messageRow, mine && styles.messageRowMine]}>
                                        <Text style={styles.senderLabel}>{mine ? '나' : message.sender === 'owner' ? '방장 선호' : '민지'}</Text>
                                        <View style={[styles.messageBubble, mine && styles.messageBubbleMine]}>
                                            <Text style={[styles.messageText, mine && styles.messageTextMine]}>{message.text}</Text>
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                        <View style={styles.chatComposer}>
                            <TextInput
                                style={styles.chatInput}
                                placeholder="메시지 입력 · @linkro 사용 가능"
                                placeholderTextColor="#a1a8b8"
                                value={messageInput}
                                onChangeText={setMessageInput}
                                multiline
                                maxLength={500}
                            />
                            <Pressable style={styles.sendButton} onPress={sendMessage}>
                                <Ionicons name="arrow-up" size={21} color={WHITE} />
                            </Pressable>
                        </View>
                    </View>
                )}

                {tab === 'vote' && (
                    <View style={styles.panel}>
                        <View style={styles.rowBetween}>
                            <Text style={styles.cardTitle}>약속역 후보</Text>
                            <Text style={styles.counter}>{proposals.length}/5</Text>
                        </View>
                        <Text style={styles.caption}>후보당 1표씩 투표할 수 있고 여러 후보에 각각 투표할 수 있어요. 투표는 참고용이며 자동 확정되지 않습니다.</Text>

                        {proposals.map(proposal => {
                            const mine = votes[role].includes(proposal.id);
                            const count = proposal.baseVotes
                                + Number(votes.OWNER.includes(proposal.id))
                                + Number(votes.MEMBER.includes(proposal.id));
                            const canDelete = isOwner || proposal.proposer === 'member';
                            return (
                                <View key={proposal.id} style={styles.proposalCard}>
                                    <View style={styles.rowBetween}>
                                        <View style={styles.proposalTitleArea}>
                                            <Ionicons name="train-outline" size={20} color={NAVY} />
                                            <Text style={styles.proposalName}>{proposal.station}</Text>
                                            {selectedStation === proposal.station && <Text style={styles.confirmedBadge}>확정</Text>}
                                        </View>
                                        <Text style={styles.counter}>{count}표</Text>
                                    </View>
                                    <Text style={styles.proposerText}>제안자: {proposal.proposer === 'owner' ? '방장' : '민지'} · 예시 데이터</Text>
                                    <View style={styles.proposalActions}>
                                        <Pressable style={[styles.voteButton, mine && styles.votedButton]} onPress={() => vote(proposal.id)}>
                                            <Ionicons name={mine ? 'checkmark-circle' : 'heart-outline'} size={16} color={mine ? WHITE : NAVY} />
                                            <Text style={[styles.voteButtonText, mine && styles.votedText]}>{mine ? '투표 취소' : '투표하기'}</Text>
                                        </Pressable>
                                        {isOwner && <Pressable style={styles.confirmButton} onPress={() => confirmStation(proposal.station)}><Text style={styles.confirmButtonText}>최종 확정</Text></Pressable>}
                                        {canDelete && <Pressable style={styles.deleteButton} onPress={() => removeProposal(proposal)}><Text style={styles.deleteText}>삭제</Text></Pressable>}
                                    </View>
                                </View>
                            );
                        })}

                        <Text style={[styles.cardTitle, { marginTop: 18 }]}>후보 제안</Text>
                        <Text style={styles.caption}>미리보기 예시 역 중 하나를 선택해 보세요. 실제 서비스에서는 역 검색 결과의 stationId를 사용합니다.</Text>
                        <View style={styles.stationChips}>
                            {STATION_OPTIONS.map(station => (
                                <Pressable key={station} style={[styles.stationChip, suggestedStation === station && styles.stationChipSelected]} onPress={() => setSuggestedStation(station)}>
                                    <Text style={[styles.stationChipText, suggestedStation === station && styles.stationChipTextSelected]}>{station}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Pressable style={styles.primaryButton} onPress={suggest}>
                            <Ionicons name="add-circle-outline" size={19} color={WHITE} />
                            <Text style={styles.primaryText}>약속역 후보 제안</Text>
                        </Pressable>
                    </View>
                )}

                {tab === 'members' && (
                    <View style={styles.panel}>
                        <Text style={styles.cardTitle}>참여자 · 출발역</Text>
                        <Text style={styles.caption}>모든 멤버는 자신의 출발역을 설정할 수 있습니다.</Text>
                        {[
                            { name: isOwner ? '나' : '선호', role: '방장', station: '서울역' },
                            { name: isOwner ? '민지' : '나', role: '멤버', station: '강남역' },
                            ...(max >= 3 ? [{ name: '준호', role: '멤버', station: '왕십리역' }] : []),
                        ].map((member, index) => (
                            <View key={index} style={styles.memberRow}>
                                <View style={styles.avatar}><Ionicons name="person" size={18} color={NAVY} /></View>
                                <View style={styles.memberDetails}>
                                    <Text style={styles.memberName}>{member.name} <Text style={styles.memberRole}>· {member.role}</Text></Text>
                                    <Text style={styles.caption}>출발역 예시: {member.station}</Text>
                                </View>
                            </View>
                        ))}
                        <Pressable style={styles.secondaryButton} onPress={() => showPending('내 출발역 설정')}>
                            <Text style={styles.secondaryButtonText}>내 출발역 설정·변경</Text>
                        </Pressable>
                        <View style={styles.divider} />
                        <Pressable style={styles.secondaryButton} onPress={() => showPending('중간역 추천')}>
                            <Text style={styles.secondaryButtonText}>참여자 출발역으로 중간역 추천받기</Text>
                        </Pressable>
                    </View>
                )}

                {!!notice && (
                    <View style={styles.notice}>
                        <Ionicons name="information-circle-outline" size={19} color={NAVY} />
                        <Text style={styles.noticeText}>{notice}</Text>
                    </View>
                )}
                <Pressable style={styles.returnButton} onPress={() => router.replace('/rooms')}>
                    <Text style={styles.returnText}>약속방 목록으로 돌아가기</Text>
                </Pressable>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },
    header: { backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 15, borderBottomWidth: 1, borderColor: BORDER },
    backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '800', color: NAVY },
    content: { padding: 18, paddingBottom: 44 },
    demoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, backgroundColor: '#e9edf5', padding: 12, marginBottom: 15 },
    demoText: { flex: 1, color: NAVY, fontSize: 12, lineHeight: 18 },
    roomCard: { padding: 19, backgroundColor: NAVY, borderRadius: 18, marginBottom: 15 },
    roomCardTop: { flexDirection: 'row', gap: 7, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 17 },
    roomName: { flex: 1, color: WHITE, fontSize: 21, fontWeight: '800', lineHeight: 29 },
    roomStatus: { paddingHorizontal: 9, paddingVertical: 6, backgroundColor: '#334869', borderRadius: 11 },
    roomStatusText: { color: '#dce5f5', fontSize: 10, fontWeight: '800' },
    roomInfo: { color: '#e0e5ef', fontSize: 13, marginTop: 9 },
    roleCard: { backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 15, padding: 15, marginBottom: 13 },
    roleHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardTitle: { color: NAVY, fontSize: 16, fontWeight: '800', marginBottom: 8 },
    roleHint: { fontSize: 11, color: PURPLE, fontWeight: '700' },
    roleButtons: { flexDirection: 'row', gap: 8, marginTop: 8 },
    roleButton: { flex: 1, paddingVertical: 12, borderWidth: 1, borderRadius: 11, borderColor: BORDER, backgroundColor: '#f7f8fa', alignItems: 'center' },
    roleButtonActive: { borderColor: MINT, backgroundColor: '#eafbf5' },
    roleButtonText: { color: SECONDARY, fontWeight: '700', fontSize: 13 },
    roleButtonTextActive: { color: NAVY },
    roleInfo: { color: SECONDARY, fontSize: 12, lineHeight: 19, marginTop: 11 },
    ownerArea: { backgroundColor: '#f0eefd', borderRadius: 15, padding: 16, marginBottom: 15 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    ownerButtons: { flexDirection: 'row', gap: 9, marginTop: 13 },
    secondaryButton: { flex: 1, borderWidth: 1, borderColor: BORDER, backgroundColor: WHITE, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
    secondaryButtonText: { color: NAVY, fontSize: 12, fontWeight: '700', textAlign: 'center' },
    clearButton: { alignSelf: 'flex-start', marginTop: 12 },
    clearText: { color: '#ad394b', fontSize: 12, fontWeight: '700' },
    tabs: { flexDirection: 'row', gap: 7, marginBottom: 12 },
    tab: { flex: 1, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: WHITE, paddingVertical: 12, borderRadius: 11, borderWidth: 1, borderColor: BORDER },
    tabActive: { backgroundColor: '#eafbf5', borderColor: MINT },
    tabText: { color: SECONDARY, fontSize: 12, fontWeight: '700' },
    tabTextActive: { color: NAVY },
    panel: { backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 17, padding: 16 },
    caption: { color: SECONDARY, fontSize: 12, lineHeight: 19 },
    chatList: { marginVertical: 20, gap: 14 },
    systemBubble: { alignSelf: 'center', backgroundColor: '#f1f3f7', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
    systemText: { fontSize: 11, color: SECONDARY, textAlign: 'center', lineHeight: 17 },
    messageRow: { alignSelf: 'flex-start', maxWidth: '90%', alignItems: 'flex-start' },
    messageRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
    senderLabel: { color: SECONDARY, fontSize: 11, marginBottom: 6 },
    messageBubble: { backgroundColor: '#edf0f6', borderRadius: 15, paddingHorizontal: 13, paddingVertical: 10 },
    messageBubbleMine: { backgroundColor: NAVY },
    messageText: { color: NAVY, fontSize: 13, lineHeight: 20 },
    messageTextMine: { color: WHITE },
    chatComposer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderTopWidth: 1, borderColor: BORDER, paddingTop: 13 },
    chatInput: { flex: 1, maxHeight: 110, minHeight: 44, borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: NAVY, backgroundColor: '#fafbfc', fontSize: 13 },
    sendButton: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', backgroundColor: NAVY, borderRadius: 12 },
    counter: { color: SECONDARY, fontSize: 12, fontWeight: '700' },
    proposalCard: { borderWidth: 1, borderColor: BORDER, backgroundColor: '#fafbfc', borderRadius: 13, padding: 13, marginTop: 13 },
    proposalTitleArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
    proposalName: { color: NAVY, fontWeight: '800', fontSize: 15 },
    confirmedBadge: { overflow: 'hidden', backgroundColor: '#e1f9f0', color: '#138561', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, fontSize: 10, fontWeight: '700' },
    proposerText: { color: SECONDARY, fontSize: 11, marginTop: 9 },
    proposalActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 13, flexWrap: 'wrap' },
    voteButton: { borderWidth: 1, borderColor: BORDER, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 9, flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: WHITE },
    votedButton: { backgroundColor: NAVY, borderColor: NAVY },
    voteButtonText: { color: NAVY, fontSize: 11, fontWeight: '700' },
    votedText: { color: WHITE },
    confirmButton: { backgroundColor: '#eafbf5', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 10 },
    confirmButtonText: { color: '#138561', fontSize: 11, fontWeight: '700' },
    deleteButton: { paddingVertical: 10, paddingHorizontal: 8 },
    deleteText: { color: '#ad394b', fontSize: 11, fontWeight: '700' },
    stationChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 13, marginBottom: 16 },
    stationChip: { borderWidth: 1, borderColor: BORDER, borderRadius: 20, paddingVertical: 9, paddingHorizontal: 11 },
    stationChipSelected: { borderColor: MINT, backgroundColor: '#eafbf5' },
    stationChipText: { color: SECONDARY, fontSize: 12, fontWeight: '600' },
    stationChipTextSelected: { color: NAVY, fontWeight: '800' },
    primaryButton: { backgroundColor: NAVY, borderRadius: 12, height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 13 },
    primaryText: { color: WHITE, fontWeight: '800', fontSize: 13 },
    memberRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 15 },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#eafbf5', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    memberDetails: { flex: 1 },
    memberName: { color: NAVY, fontWeight: '700', fontSize: 13, marginBottom: 4 },
    memberRole: { color: SECONDARY, fontSize: 11, fontWeight: '500' },
    divider: { height: 1, backgroundColor: BORDER, marginVertical: 15 },
    sectionTitle: { color: NAVY, fontSize: 16, fontWeight: '700', marginVertical: 15, textAlign: 'center' },
    notConnected: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 25, gap: 12 },
    notice: { backgroundColor: '#e9edf5', padding: 13, borderRadius: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14 },
    noticeText: { flex: 1, color: NAVY, fontSize: 12, lineHeight: 19 },
    returnButton: { paddingVertical: 19, alignItems: 'center', marginTop: 10 },
    returnText: { color: SECONDARY, fontSize: 12, fontWeight: '700' },
});
