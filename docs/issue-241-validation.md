# #241 구현 근거와 검증

## 시간 필드

BE `dev`의 `7cd69d60a6567ebd308783bd3803eef103b1df62` 기준으로 확인했다.

- [RouteSearchResponse.Summary](https://github.com/TeamProject1-MJU/BE/blob/7cd69d60a6567ebd308783bd3803eef103b1df62/src/main/java/com/mju/linkro/route/dto/RouteSearchResponse.java): `totalTimeSec`은 `arrivalAt - departureAt`이며, 환승 대기를 포함하고 첫 출발 전 대기를 제외한다. `noService`의 `departureAt`은 첫차 기준 출발 시각이다.
- [RouteSearchService.timedRoute / Wait](https://github.com/TeamProject1-MJU/BE/blob/7cd69d60a6567ebd308783bd3803eef103b1df62/src/main/java/com/mju/linkro/route/service/RouteSearchService.java): `totalTimeSec = arriveAt - leaveAt`, `waitSec = leaveAt - requested`, `totalWithWaitSec = arriveAt - requested`로 만든다. 시각표 없는 기존 경로도 `arrivalAt = departureAt + totalTimeSec`이다.

따라서 첫차 출발부터 도착까지의 시간은 세 후보 모두 같은 의미지만, FE에서 뺄셈이나 날짜 재계산 없이 서버 `totalTimeSec`을 사용한다. `noService=false`는 기존 `totalWithWaitSec ?? totalTimeSec`을 사용한다. 카드·안내·최소시간 배지/정렬이 같은 시간 값을 사용한다. 원본 응답은 변경하지 않는다.

`formatDurationMinutes`는 분을 버림한 다음 60분 이상을 시간/분으로 표시한다. 카드 큰 숫자, `formatTotalTime`, 경로 안내, 추천 참여자/평균/최대 소요 시간과 접근성 라벨에 적용했다. `formatTotalTime`의 대기 포함/약 접두어 조건은 유지했다. 구간·대기·도보·편차·검색 조건의 분 표기는 유지했다.

## 탭 전환

하단 탭에서만 `router.replace`와 `tabSwitch=1`을 사용한다. 기존 루트 스택의 네 탭 화면만 이 파라미터가 있으면 `animation: none`을 사용한다. 네이티브 교체 애니메이션은 목적 화면의 설정을 따르도록 `animationTypeForReplace: push`를 명시했다.

새 탭 내비게이터나 파일 이동 없이 반복 탭 전환 시 스택 길이를 늘리지 않는 최소 변경이다. 방 상세·경로 안내·역 검색은 기존 설정을 유지한다. 파라미터를 넘기는 기존 경로 검색 `push`도 수정하지 않았으며, `tabSwitch`가 없는 진입은 기본 애니메이션과 기존 뒤로 가기를 사용한다. 이 파라미터는 API 요청에 추가하지 않는다.

## 시트와 타임라인

시트의 세로 `ScrollView`를 `View`로 교체했다. 안전 영역·화면 높이에 따라 휠의 뷰포트와 위아래 패딩만 줄이고, 한 칸 44px·스크롤 오프셋·선택·확인·지금 출발 로직은 유지한다. 버튼 영역은 축소하지 않는다. `LogBox.ignoreLogs`는 추가하지 않았다. RN Modal은 바깥 ScrollView 컨텍스트를 초기화하므로 시트 안의 중첩 ScrollView 제거로 같은 방향 목록 중첩도 없어진다.

타임라인 출발 문구 아래 16px 간격을 추가했다. 도착 글자는 위 역 이름과 동일한 26px 들여쓰기를 사용한다. 깃발 SVG의 기둥이 세로선 중심에 맞도록 배치하고 마지막 세로선은 도착 행 전에 끝낸다.

## 검증

- 목업 `route_tab_sheet_by_case_v2.png`의 ①~⑨를 확인했다.
- 단위 검사: 59/60/63/120분, 0/NaN, 초 버림, 접두어, 첫차 대기 제외, 상대 출발 시각, 노란 안내와 응답 보존, 카드/안내/추천 총시간, 탭 교체, 작은 시트의 버튼·값 적용을 검사한다.
- `npx tsc --noEmit`: 통과.
- `npm run lint`: 기존과 동일한 오류 71개·경고 21개. 새 오류/경고 없음.
- `node --test scripts/verify-api-client.cjs`: 전체 500개 통과, 실패 0개.
- 사용 가능한 브라우저가 없어 실기기 화면·제스처와 런타임 경고의 직접 확인은 수행하지 못했다. 시트 구조 및 이벤트 동작은 컴포넌트 검사로 확인한다.
