/**
 * 추천 결과의 참여자 이동 문구 (#153, 명세 v1.13 participantTimes 추가 필드)
 *
 * 시각은 서비스 기준(서울)으로 보여주고, 값이 없으면 문구를 만들지 않아요(0분·현재 시각으로 채우지 않아요).
 * 분 계산은 경로 화면(#146)과 같은 stepMinutes(반올림, 최소 1분)를 써요. 여유 시간만 아래 규칙을 따로 써요.
 */
import { DIRECTION_LABELS, formatDestination, stepMinutes } from '@/components/route/format';
import type { BoardingTrain, ParticipantTime, RecommendationSource, StaleReason, TrainLeg } from '@/types/recommendation';
import { formatSeoulTime, formatTripTimes } from '@/utils/seoul-time';
import { formatStationName } from '@/utils/station-name';

/**
 * 약속까지 여유 시간.
 * - 양수: "약속 N분 전 도착" (N = 분 내림, 1분 미만은 1분)
 * - 0: "약속 시각에 딱 맞춰 도착"
 * - 음수: "약속보다 N분 늦게 도착" (N = 분 올림, 늦는 시간을 줄여 말하지 않아요)
 * - null(약속 없음·이전 실행): 표시 안 함
 */
export function formatSlack(slackSeconds: number | null): string | null {
    if (slackSeconds === null || !Number.isFinite(slackSeconds)) return null;
    if (slackSeconds === 0) return '약속 시각에 딱 맞춰 도착';
    if (slackSeconds > 0) return `약속 ${Math.max(1, Math.floor(slackSeconds / 60))}분 전 도착`;
    return `약속보다 ${Math.max(1, Math.ceil(-slackSeconds / 60))}분 늦게 도착`;
}

/** "2호선 성수행(내선)". 종착역·방면이 없으면 있는 값만 */
function trainLabel(train: Pick<BoardingTrain, 'lineName' | 'terminal' | 'direction'>) {
    const terminal = train.terminal ? ` ${formatDestination(train.terminal)}` : '';
    const direction = train.direction ? `(${DIRECTION_LABELS[train.direction]})` : '';
    return `${train.lineName}${terminal}${direction}`;
}

/** 탑승 열차 "강남역 18:38 · 2호선 성수행(내선)". 열차 번호는 상세에서만(withCode) */
export function formatBoardingTrain(train: BoardingTrain, withCode = false) {
    const code = withCode && train.trainCode ? ` · 열차 ${train.trainCode}` : '';
    return `${formatStationName(train.stationName)} ${formatSeoulTime(train.departureAt)} · ${trainLabel(train)}${code}`;
}

/** 열차 한 구간 "강남역 18:38 → 교대역 18:42 (2개 역)" */
export function formatLeg(leg: TrainLeg) {
    return `${formatStationName(leg.fromStationName)} ${formatSeoulTime(leg.boardAt)} → ${formatStationName(leg.toStationName)} ${formatSeoulTime(leg.alightAt)} (${leg.stationCount}개 역)`;
}

/** 열차 한 구간의 노선 표시 "2호선 성수행(내선)" (+ 상세의 열차 번호) */
export function formatLegTrain(leg: TrainLeg) {
    return `${trainLabel(leg)}${leg.trainCode ? ` · 열차 ${leg.trainCode}` : ''}`;
}

/** 이전 하차와 이 승차 사이 "환승 도보 N분 · 열차 대기 N분". 0 인 값은 빼고, 둘 다 0 이면 null */
export function formatLegTransfer(leg: TrainLeg) {
    const parts = [
        leg.walkSec > 0 ? `환승 도보 ${stepMinutes(leg.walkSec)}분` : '',
        leg.transferWaitSec > 0 ? `열차 대기 ${stepMinutes(leg.transferWaitSec)}분` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
}

/** 계산 근거 문구 */
export function sourceNote(source: RecommendationSource | null) {
    if (source === 'TIMETABLE') return '열차 시각표 기준이에요';
    if (source === 'ESTIMATE') return '고정 소요시간으로 계산한 예상값이에요';
    return '이전 계산 결과라 열차 정보가 없어요';
}

/** stale 배너와 같은 이유 문구 "약속 시각이 바뀌었어요 · 참여자나 출발역이 바뀌었어요" */
export function staleReasonText(reasons: StaleReason[] | null) {
    return [reasons?.includes('APPOINTMENT_CHANGED') && '약속 시각이 바뀌었어요', reasons?.includes('MEMBERS_CHANGED') && '참여자나 출발역이 바뀌었어요']
        .filter(Boolean).join(' · ');
}

/** 출발·도착 근처의 이전 계획 안내 */
export function stalePlanText(reasons: StaleReason[] | null) {
    const reason = staleReasonText(reasons);
    return `약속·멤버가 바뀌기 전 계획이에요${reason ? ` (${reason})` : ''}`;
}

/** "18:38 출발 → 19:00 도착". 도착 시각이 없으면 "18:38 출발"만 */
export function formatTripLine(participant: Pick<ParticipantTime, 'departureAt' | 'arriveAt'>, appointmentAt: string | null) {
    const { departure, arrival } = formatTripTimes(participant.departureAt, participant.arriveAt, appointmentAt);
    if (!departure) return '';
    return arrival ? `${departure} 출발 → ${arrival} 도착` : `${departure} 출발`;
}
