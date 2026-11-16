/**
 * 화면 글자 줄 맞춤 기준값 (#224)
 *
 * - 카드·탭·버튼 같은 상자는 바깥 테두리를 화면 여백(SCREEN_GUTTER)에 맞춰요.
 * - 상자 밖 글자 줄(제목, 섹션 제목, 안내 문구, 목록 줄)은 상자 안 글자와 같은 선(TEXT_INSET)에서 시작해요.
 *   화면 여백은 이미 내용 영역에 들어가 있으니, 글자 줄에는 카드 안쪽 여백만큼만 더 넣어요.
 */

/** 기본 화면 좌우 여백 */
export const SCREEN_GUTTER = 20;

/** 기본 카드 안쪽 여백 */
export const CARD_PADDING = 16;

/** 상자 밖 글자 줄의 시작선 (화면 여백 + 카드 안쪽 여백) */
export const TEXT_INSET = SCREEN_GUTTER + CARD_PADDING;

/** 약속방 화면(상세, 중간역 찾기·추천 결과)에서 가장 많이 쓰는 카드 안쪽 여백 */
export const ROOM_CARD_PADDING = 14;
