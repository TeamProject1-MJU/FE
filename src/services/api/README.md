# 서비스에서 쓰는 법

`.env.example`을 `.env`로 복사합니다. `EXPO_PUBLIC_USE_MOCK`은 생략하면 `true`이고, 정확히 `true`일 때만 mock입니다. 서버를 쓰려면 `false`와 `/api/v1`까지 포함한 `EXPO_PUBLIC_API_BASE_URL`을 설정하고 앱을 완전히 새로고침합니다. 환경변수는 빌드에 포함되므로 토큰은 넣지 않습니다.

현재 인증, 내 정보·닉네임 수정·탈퇴(`services/user.ts`), 역 검색·역 상세·노선 목록(`services/station.ts`), 혼잡도 조회(`services/congestion.ts`), 경로 검색(`services/route.ts`), 실시간 도착정보(`services/arrivals.ts`), 방 생성·참여·목록·상세·멤버 조회·수정·초대 코드·나가기·최종 약속역(`services/room.ts`), 중간역 추천(`services/recommendation.ts`), 약속역 후보 제안·목록·삭제·투표(`services/room.ts` → `services/room-proposals.ts`)가 서버 모드를 지원해요.

```ts
import { get, post, delete as apiDelete } from '@/services/api/client';
import { useMock as isMockMode } from '@/services/api/config';
import { ApiError } from '@/services/api/errors';
import type { StationSearchResult } from '@/types/station';

// 서비스에서는 먼저 mock을 분기합니다. 클라이언트는 실제 요청만 담당합니다.
// if (isMockMode()) return 기존Mock결과;

const stations = await get<StationSearchResult>('/stations', {
    query: { keyword: '강남', page: 0, size: 50 },
});

try {
    const room = await post<{ id: string }>('/rooms', {
        name: '저녁 약속', appointmentAt: null,
    });
    await apiDelete(`/rooms/${room.id}/members/me`);
} catch (error) {
    if (error instanceof ApiError) {
        // code는 서버 값을 그대로 유지하고, message는 서버 문구를 우선합니다.
        // 화면에는 코드별 안내만 표시하고 오류 원문과 details는 기록하지 않아요.
    } else {
        throw error;
    }
}
```

`get`, `post`, `put`, `patch`, `delete`를 제공합니다. 본문이 있는 메서드는 `(경로, 본문, 옵션)`, 나머지는 `(경로, 옵션)`으로 호출합니다. 응답은 공통 봉투의 `data`만 반환하며, 본문이 없는 성공은 `undefined`입니다. `query`의 `null`·`undefined`는 제외하고, 요청과 응답 본문 읽기에 10초 제한을 적용합니다. 네트워크·시간 초과는 `NETWORK_ERROR`, JSON 파싱·응답 형식 오류는 `UNKNOWN_ERROR`입니다.

## 토큰 주입 자리

```ts
import { setAccessTokenProvider, post } from '@/services/api/client';

// 앱에서는 auth.ts가 등록하므로 화면에서 직접 덮어쓰지 않아요. 비동기 함수도 가능해요.
const readCurrentAccessToken = (): string | null => null;
setAccessTokenProvider(readCurrentAccessToken);

// 인증이 필요 없는 요청은 auth: false로 헤더를 생략합니다.
// await post('/auth/kakao', 요청본문, { auth: false });

// 연결 해제
setAccessTokenProvider(null);
```

토큰이 있을 때만 Authorization 헤더를 붙여요. 인증 모듈이 아래 등록 함수로 갱신과 실패 처리를 연결해요.

## 인증 (#88, v1.12 4.1~4.3)

- `loginWithKakao()`는 SDK `login()` 결과를 `/auth/kakao`에 보내고 응답을 검사한 뒤 저장과 `signIn`을 수행해요. 취소는 `isKakaoLoginCancelled`로 구분해요. SDK가 카카오톡 미설치 시 계정 로그인으로 폴백해요.
- `auth.ts`를 앱 시작 시 불러오면 `setAccessTokenProvider`, `setTokenRefresher`, `setAuthFailureHandler`, `setSessionGenerationProvider`를 등록해요. 클라이언트는 인증 서비스를 import하지 않아요.
- 서버 모드에서는 `AuthGate`가 `restoring` 동안 화면을 가리고 `refreshSession()`으로 복원해요. 사용자 정보는 `{ userId: null, nickname: null }`로 시작하고, 마이페이지의 `fetchMe()`가 서버에서 확인해 세션을 갱신해요.
- Access Token은 메모리, Refresh Token만 SecureStore에 저장해요. 웹은 모두 메모리에만 보관하므로 새로고침하면 로그아웃돼요. 웹에서 실제 카카오 로그인은 지원하지 않아요.
- 인증이 필요한 요청마다 사용한 토큰과 세대를 기록해요. 401 `TOKEN_EXPIRED`는 같은 세대에서 토큰이 이미 바뀌었다면 현재 토큰으로, 아니라면 갱신 후 원래 요청을 한 번만 재시도해요. client의 진행 중 Promise와 서비스의 세대별 Promise를 공유하므로 앱 복원과 요청 갱신이 겹쳐도 refresh는 한 번이에요. 완료 후 Promise를 비워 다음 만료를 처리해요.
- 갱신 응답의 새 Refresh Token 저장에 성공해야 로그인 상태로 전환해요. 만료 시간은 응답 검사에만 사용하고 선제 갱신하지 않아요. 로그인·로그아웃과 인증 무효화 때 세대를 바꿔 이전 응답이 새 상태를 바꾸지 못하게 해요.
- 갱신 401 또는 인증 무효 오류는 토큰 삭제와 `signedOut` 후 `resetToLogin()`으로 이동해요. `TOKEN_INVALID`·`AUTH_REQUIRED`는 갱신 없이 이동해요. `auth:false`인 세 인증 요청에는 헤더·자동 갱신을 적용하지 않아요. 역 검색의 기존 인증 안내는 화면 내부 표시이며, AuthGate가 보호 화면을 가려 별도 이동이나 팝업을 추가하지 않아요.
- 갱신의 409·5xx는 토큰을 유지하고 호출자에게 오류를 전달해 재시도할 수 있어요. 네트워크·시간 초과는 `NETWORK_ERROR`를 전달하고 토큰을 유지해요. 서버에서 회전했으나 응답만 유실됐을 수 있어 같은 실행 중에는 동일 토큰으로 자동 갱신을 다시 보내지 않아요(`REFRESH_UNCERTAIN`). 복원 화면의 카카오 재로그인 또는 로그아웃 후 재로그인으로 복구해요. 앱 재시작 후에는 메모리의 불확실 상태를 알 수 없어서 남은 저장 토큰으로 복원을 한 번 시도할 수 있어요. 이 경우 서버의 재사용 감지로 해당 로그인 계열이 폐기될 수 있고 재로그인이 필요해요.
- `logoutSession()`은 서버 호출 결과와 관계없이 메모리를 비우고 `signedOut`으로 바꿔요. 결과의 `server`는 성공·실패·생략, `storageCleared`는 기기 삭제 결과예요. 삭제 실패 시 현재 실행에서는 저장값 재사용을 막고 안내를 표시하지만, 재시작 시 다시 읽힐 수 있어요. 서버 로그아웃이 성공했다면 남은 저장값은 폐기된 값이에요. 서버 호출과 삭제가 모두 실패했다면 재시작 때 복원될 가능성이 있으므로 기기 저장소 문제를 해결한 후 다시 로그아웃해야 해요.
- mock 모드는 기존 프로필과 로그인·로그아웃·탈퇴 흐름을 유지하며 서버를 호출하지 않아요. `unknown`의 개발용 직접 접근도 mock에서만 허용해요. 서버 모드의 모든 보호 화면은 AuthGate가 막아요.

## 역 검색

```ts
import { searchStations } from '@/services/station';

const result = await searchStations(' 강남 ', { lineId: 2, page: 0, size: 50 });
// result: { items, page, size, totalElements }
```

빈 검색어는 서버를 호출하지 않고 빈 결과를 반환합니다. 페이지는 0 이상, 크기는 1~50으로 제한합니다. mock에서도 기존 이름 정규화·정렬·미제공 역을 유지하며 노선과 페이지 옵션을 적용합니다.

빈 검색어는 서버를 부르지 않고, 50자를 넘는 검색어는 서버를 부르지 않고 `VALIDATION_ERROR`(400)를 던집니다. 응답에 화면이 쓰는 필드가 빠져 있으면 `UNKNOWN_ERROR`입니다.

## 역 상세·노선 목록

```ts
import { fetchLines, fetchStation } from '@/services/station';

const station = await fetchStation(222); // 명세 5.3, 5.2 items 한 건과 같은 모양
// 없는 역은 error.code === 'STATION_NOT_FOUND'(404). mock 모드에서는 mock 목록에서 찾습니다.

const lines = await fetchLines(); // 명세 5.1 [{ id, lineCode, name, color }]
// 서버 호출이 실패하면(401 포함) 오류 대신 기존 노선 값(mocks/stations.ts의 MOCK_LINES)을 돌려줍니다.
// 이때 돌려주는 MOCK_LINES는 표시용이며, 서버 요청의 ID(예: lineId 필터)로 쓰지 않습니다.
```

## 혼잡도 조회

```ts
import { fetchCongestion } from '@/services/congestion';
import { toCongestion } from '@/types/congestion';

// 명세 6.2 GET /congestion. date가 있으면 dayType은 보내지 않습니다(서버가 영업일로 정함).
const data = await fetchCongestion({ stationId: 222, lineId: 2, direction: 'INNER', time: '08:10', date: '2026-11-11' });
// date가 없으면 dayType이 필수입니다.
await fetchCongestion({ stationId: 222, lineId: 2, direction: 'INNER', time: '08:10', dayType: 'WEEKDAY' });

const congestion = toCongestion(data); // 6.1과 같은 { supported, kind, pct, level, levelLabel }
// 슬롯 표시는 data의 { slotStart, slotDate, firstTrain }을 components/route/Congestion.tsx의 slot으로 넘깁니다.
```

- `direction`은 서버 값을 그대로 씁니다(1호선 `UP` = 소요산 방향, `DOWN` = 인천·신창 방향, 2호선 `INNER`/`OUTER`). 앱에서 방향을 뒤집지 않습니다.
- `supported: false`(데이터 없음, 그 노선에 없는 방향)는 오류가 아닌 정상 응답이며 화면은 회색 "혼잡도 데이터 미제공"입니다.
- 잘못된 `time`(00:00~23:59 밖)·`date`·`direction`·ID, `date`도 `dayType`도 없는 요청은 서버를 부르지 않고 `VALIDATION_ERROR`(400)를 던집니다. mock 모드도 같습니다.
- 응답에 필수 필드가 빠졌거나, `supported: true`인데 `pct`·`level`·`levelLabel`·`source`가 없으면 `UNKNOWN_ERROR`입니다.
- 서버 오류 코드는 그대로 전달합니다: `VALIDATION_ERROR`(400), 401 계열, `STATION_NOT_FOUND`(404), `NOT_FOUND`(404, 지원 역인데 그 노선에 속하지 않음, `details.lineId`).
- mock은 영업일 규칙(05:30~다음 날 00:30, 30분 칸 39개, 01:00~05:29는 첫차 05:30 칸)을 따르며 막차 이후 대체는 하지 않습니다. 둘째 인자 `'error'`·`'network'`로 서버 오류·네트워크 실패를 흉내 낼 수 있고, 서버 모드에서는 무시합니다.

401 처리는 공통 클라이언트와 인증 서비스에서 담당해요. 화면에서는 `isAuthError(error)`로 구분할 수 있어요.

## 내 정보·닉네임·탈퇴 (#90, v1.12 4.4~4.6)

- `fetchMe()`는 `GET /users/me`의 문자열 `id`, `nickname`, `createdAt`을 검사하고 인증 상태를 유지한 채 세션 정보를 갱신해요. 앱 재시작 후에도 마이페이지에서 다시 조회해요.
- `updateNickname(value)`는 앞뒤 공백을 뺀 코드 포인트 2~20자를 검사한 뒤 `PATCH /users/me`에 `{ nickname }`을 보내요. 응답은 `{ id, nickname }`이며 가입 시각을 만들지 않아요. 응답으로 화면과 세션을 갱신해요. 실패하면 입력을 유지하고, `ROOM_BUSY`는 잠시 후 다시 시도하도록 안내해요.
- `withdraw()`는 `DELETE /users/me` 성공 후 로컬 인증·저장값·선택 경로를 지우고 이전 화면 기록 없이 로그인으로 이동해요. 서버가 이미 인증을 폐기하므로 `/auth/logout`은 부르지 않아요. 서버에서는 모든 방에서 나가고 방장이 승계되며, 마지막 참여자의 방은 삭제돼요. 같은 계정 재로그인 시 방은 복구되지 않아요.
- 탈퇴의 `ROOM_BUSY`·네트워크 실패·시간 초과는 로그인과 선택 경로를 유지해요. 응답 유실 뒤 재시도한 `TOKEN_INVALID`는 기존 공통 인증 처리에 맡기고 시트에서 중복 안내·이동을 하지 않아요. 탈퇴 성공과 인증 무효화는 진행 중인 갱신도 무효화해 늦은 응답이 로그인 상태를 되살리지 못하게 해요.
- 서버 오류는 `ApiError`의 코드를 그대로 전달해요. `UserError`는 기존 mock 실패와 호출 전 닉네임 검사용으로 유지해요. mock 모드와 화면 테스트 플래그는 서버를 호출하지 않아요.

실행 검사는 프로젝트 루트에서 `node --test scripts/verify-api-client.cjs`로 돌립니다. 실제 서버와 추가 패키지 없이 응답·오류·인증 헤더·시간 초과·mock 검색을 확인합니다.

## 경로 검색 (#92, 명세 6.1)

```ts
import { searchRoute } from '@/services/route';

await searchRoute(origin, destination);
await searchRoute(origin, destination, { roomId });
// POST /routes/search: { originStationId, destinationStationId, roomId? }
```

- 서버 모드는 서버 역 ID를 보내요. 홈에서 이름으로 넘어온 초기값도 `searchStations`로 이름 끝의 "역"을 제외한 값이 같은 지원 역을 찾아요. 못 찾거나 조회에 실패하면 비워 두고, 늦은 응답은 새로 선택한 역을 덮지 않아요.
- `roomId`는 전달됐을 때만 본문에 넣고 `departAt`은 보내지 않아요. 공통 클라이언트의 10초 제한과 기존 A-1 인증 처리를 사용하며 경로 서비스의 재시도는 추가하지 않아요.
- `routeSource`, 경로·요약·단계·정차역의 화면 사용 필드를 검사해요. 빠지거나 타입이 다르면 `ApiError('UNKNOWN_ERROR')`가 발생하고 서비스 경계에서 `RouteSearchError('EXTERNAL_API_ERROR')`로 바뀌어요.
- 6.1 혼잡도의 출처는 `kind`예요(6.2만 `source`). `toCongestion`으로 정리하고 혼잡도가 `null`이면 미제공, `stations: null`이면 빈 배열로 처리해요. 도보의 `line: null`, `path: null`, `routeType: null`, 정차역의 `slotDate: null`을 허용해요.
- 도착 시각·요금·소요시간·방향·혼잡도 단계와 라벨은 서버 값을 사용하며 재계산하거나 방면 문구를 만들지 않아요. 대기 필드는 없어도 정상이고 `totalWithWaitSec ?? totalTimeSec`로 표시해요. 미제공 혼잡도는 회색, 추정 요금은 "예상", `direction: null`인 방향은 `directionCode`로 표시해요.
- `STATION_UNSUPPORTED`(422), `ROUTE_NOT_FOUND`·`STATION_NOT_FOUND`·`ROOM_NOT_FOUND`(404), `NOT_ROOM_MEMBER`(403)는 같은 `RouteSearchError` 코드, 네트워크·시간 초과는 `NETWORK_ERROR`, 나머지는 `EXTERNAL_API_ERROR`로 전달해요. `TOKEN_*`과 공통 인증 오류는 `ApiError` 그대로 전달하고 화면에서 중복 안내하지 않아요.
- `NOT_ROOM_MEMBER`는 방 접근 불가, `ROOM_NOT_FOUND`는 삭제됐거나 존재하지 않는 방으로 구분해 안내해요. 두 오류에서는 경로 재시도 대신 약속방 목록으로 이동하며, 방 목록은 화면에 돌아올 때 서버에서 다시 조회해요.
- `TIMETABLE`은 시각표 출처로 그대로 보존하고 `ESTIMATED`로 변환하거나 시간에 "약"을 붙이지 않아요. 대기 포함 총시간은 서버의 `totalWithWaitSec`을 우선 사용하며 `waitSec`을 다시 합산하지 않아요. `null`·필드 생략은 유지하고, 알 수 없는 대기 출처는 거절해요.
- mock 모드의 기존 경로·대기·도착 시각 생성은 유지해요. 방 화면 호출 연결, 출발 시각 선택, 지도와 추천 API는 이번 범위 밖이에요. 실시간 도착정보는 아래 항목에서 다뤄요.

## 실시간 도착정보 (#95, 명세 6.3)

```ts
import { fetchArrivals } from '@/services/arrivals';
import { formatNextTrain } from '@/components/route/format';

// GET /stations/222/arrivals?lineId=2&nextStationId=223&directionCode=INNER&limit=2
const data = await fetchArrivals({ stationId: 222, lineId: 2, nextStationId: 223, directionCode: 'INNER', limit: 2 });
if (data.available) {
    const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(data.receivedAt!)) / 1000));
    data.trains.map(train => formatNextTrain(train, elapsed)); // "성수행 2분 5초" · "성수행 곧 도착" · "성수행 · 2번째 전역"
}
```

- `lineId`는 항상 보내고 `nextStationId`·`directionCode`·`limit`은 값이 있을 때만 보내요. `limit`은 1~5로 맞춰요(BE 기본 3·최대 10). 역·노선·다음 역 ID가 양의 정수가 아니거나 방향 값이 다르면 서버를 부르지 않고 `VALIDATION_ERROR`(400)를 던져요(`/stations/NaN/arrivals` 방지).
- `NextTrains`는 첫 승차 구간의 `stops[0].id`(역), `line.id`(노선), `stops[1].id`(`nextStationId`), `directionCode`, `limit: 2`로 불러요.
- 응답은 BE `ArrivalResponse` 기준이에요. 서버는 `stationId`·`lineId`·`nextStationName`을 보내지 않아서 필수로 검사하지 않아요(숫자로 올 때만 담아요). `available`은 boolean이어야 해요.
- `available: false`는 오류가 아닌 정상 응답이에요. BE는 이때도 `reason`(`UNSUPPORTED_STATION`·`NO_DATA`·`UPSTREAM_ERROR`·`DISABLED`)·`receivedAt`(null 가능)·`trains`(`[]`)를 항상 보내요. 앱은 `reason`만 확인하고 `trains`는 빈 배열로 돌려줘요. 화면은 "다음 열차" 줄만 숨겨요.
- `available: true`이면 `reason`은 null이라 검사하지 않아요. `receivedAt`(`+09:00` 오프셋이 붙은 ISO 문자열, 시각으로 읽혀야 해요)과 `trains` 배열(빈 배열 허용)을 검사해요. 열차마다 아래를 검사하고, 맞지 않으면 `UNKNOWN_ERROR`예요.
  - `destinationName`: 문자열. 이전 이름 `destinationLabel`도 같은 값으로 받아요.
  - `secondsUntil`: 숫자 또는 null. "[N]번째 전역"처럼 알 수 없으면 null이에요.
  - `message`: 문자열(null도 받아요). null이 아니라 항상 서울시 `arvlMsg2` 원문이에요. 예: "2분 50초 후", "전역 출발", "[2]번째 전역"
  - `directionCode`: 5개 값 또는 null(매핑되지 않으면 null). 없으면 null로 받아요.
  - 화면이 쓰지 않는 `stopsAway`("[N]번째 전역"이 아니면 null)·`lastTrain`·`express`는 형식이 맞을 때만 담고, 없거나 다르면 빼요.
- 서버 오류 코드는 그대로 전달해요. 401 계열은 공통 클라이언트(A-1)가 갱신·로그인 이동을 처리한 뒤 던져요.
- 표시 규칙(`formatNextTrain`):
  - `secondsUntil`이 숫자이면 `message`와 상관없이 카운트다운해요. 남은 초 = max(0, `secondsUntil` − `receivedAt` 이후 지난 초). 60초 미만이면 "성수행 곧 도착", 그 밖에는 "성수행 N분 N초"예요(60초 → "1분 0초", 59초·0초 → "곧 도착").
  - `secondsUntil`이 null일 때만 `message`를 시간 대신 "성수행 · 2번째 전역"처럼 보여줘요. `message` 맨 앞 "[N]"은 대괄호만 빼요("[3]번째 전역 (남영)" → "의정부행 · 3번째 전역 (남영)"). 나머지 글자는 원문 그대로예요. `message`가 이미 "성수행"으로 시작하면 행선지는 한 번만 나와요. `message`도 비어 있으면 "성수행"만 보여줘요.
  - 행선지는 `formatDestination`으로 "성수" → "성수행"처럼 "행"을 붙여요. 이미 "행"으로 끝나면 붙이지 않아요.
- `NextTrains`는 화면에 들어올 때 바로 한 번, 이후 20초마다 불러요(서버가 역·노선별 10~20초 캐시와 일일 한도가 있어 15~30초를 지켜요). 이전 요청이 끝나지 않았으면 다음 폴링을 건너뛰어요. `available: false`·열차 없음·`receivedAt`을 읽을 수 없음·호출 실패(`UNKNOWN_ERROR` 포함)는 줄을 숨기고, 인증 오류는 이전 값을 그대로 둬요. 토큰을 갱신하는 동안에는 요청이 끝나지 않아 이전 값이 계속 보여요.
- mock 모드는 기존 동작을 유지하고 서버를 부르지 않아요. mock 응답도 실서버와 같은 필드 이름이고 `message`에 "3분 2초 후" 같은 문구를 채워요. 둘째 인자 `'none'`(available:false)·`'fail'`(호출 실패)은 mock 모드에서만 쓰고 서버 모드에서는 무시해요. 안내 화면 주소에 `&arrivals=none` 또는 `&arrivals=fail`을 붙여 확인해요.
- 경로 검색(6.1)의 대기 필드(`waitSec`, `nextTrains`) 표시는 이번 범위가 아니에요.

## 방 목록·상세·멤버 조회 (#94, 명세 7.3·7.4·7.6)

```ts
import { fetchMyRooms, fetchRoomDetail, fetchRoomMembers } from '@/services/room';

await fetchMyRooms(); // GET /rooms, 약속 시각 순 정렬·시각 미정은 맨 뒤예요.
await fetchRoomDetail(roomId); // GET /rooms/{roomId}
await fetchRoomMembers(roomId); // GET /rooms/{roomId}/members
```

- 서버 응답을 `unknown`으로 받아 UUID·역·노선·상태·역할·시각·멤버 필드를 검사해요. `selectedStation`·`departureStation`은 `{ id, name, isSupported, lines: [{ lineId, lineName, color }] } | null`이에요. 상세의 ownerId·myRole·멤버 역할도 일치해야 해요.
- 목록(7.3)의 `memberCount`는 필수예요. 실서버 상세(7.4)는 이 필드 없이 전체 `members`를 보내므로, 검사한 `members.length`를 화면·공용 캐시의 인원수로 사용해요. 상세에 `memberCount`가 함께 오면 정수이고 멤버 수와 같은지도 검사해요.
- `getMyUserId()`는 서버 모드에서 auth-store의 사용자 ID를 사용해요. Refresh Token 복원 직후 ID가 비어 있으면 기존 `fetchMe()`(4.4)로 한 번 확인하며 동시 조회는 공유해요. 로그인·사용자 서비스는 변경하지 않아요.
- `room-cache.ts`는 마지막으로 받은 서버 목록·상세·멤버 정보를 메모리에 보관해요. 계정·로그인 세대를 구분하고 복사본을 반환해요. 로그아웃·계정 변경 후 조회나 늦은 응답으로 이전 계정의 캐시를 재사용하지 않아요. 목록에서 빠진 방이나 403·404로 거절된 방도 제거해요.
- `getMockRoom`·`getMockMembers`는 서버 모드에서 캐시만 읽고 mock 방으로 대체하지 않아요. 채팅 API는 mock을 유지하며 이 방 정보를 읽어요. 후보는 #101부터 서버 7.14~7.17을 불러요(아래 "약속역 후보" 항목). 채팅은 캐시 상세를 우선 사용하고 없으면 실제 상세 조회를 해요. 추천은 #99부터 서버 8.1~8.3을 불러요(아래 "중간역 추천" 항목).
- ROOM_NOT_FOUND·NOT_ROOM_MEMBER·NETWORK_ERROR·VALIDATION_ERROR·ROOM_BUSY는 같은 RoomError 코드로 전달해요. 형식 오류와 그 밖의 서버 오류는 UNKNOWN_ERROR예요. TOKEN_*과 공통 인증 오류는 ApiError 그대로 A-1에 맡겨요.
- 서버 모드의 `fetchMyRooms`·`fetchRoomDetail`은 mock 실패·빈 목록 플래그를 무시해요. 화면의 로딩·빈 목록·재시도·접근 불가 표시는 실제 응답에 따라 동작해요.
- 생성·참여는 #97, 초대 코드 조회·방 정보 수정·출발역 변경은 #106, 후보·투표는 #101에서 연동해요. 나가기·승계·채팅·WebSocket의 실제 API 연동은 범위 밖이에요. mock 데이터·이벤트를 서버 응답으로 표시하거나 저장하지 않아요.
- 실서버 확인은 Swagger에서 같은 계정으로 방을 만든 뒤 웹에서 GET /rooms·상세·멤버 응답과 화면을 비교해요. 빈 계정, 일반 멤버/방장, 403·404도 확인해요. 테스트용 토큰 주입 코드와 `.env`는 커밋하지 않아요.


## 방 생성·참여 (#97, 명세 7.1·7.2)

```ts
import { createRoom, joinRoom } from '@/services/room';

const created = await createRoom({ name: '  금요일 모임  ', appointmentAt: null });
// POST /rooms: { name: '금요일 모임', appointmentAt: null }. maxMembers는 보내지 않아요.
const joined = await joinRoom('a3k9pz ');
// POST /rooms/join: { roomCode: 'A3K9PZ' } → { roomId }
```

- 이름은 기존 `roomNameLength`대로 앞뒤 공백을 뺀 유니코드 코드 포인트 1~30자를 검사해요. 문자열이 아니거나 길이가 맞지 않으면 전송 전에 `VALIDATION_ERROR`예요. 선택 시각은 null 또는 시간대가 포함된 ISO 문자열이에요. mock 실패 플래그는 서버 모드에서 무시해요.
- 201 응답을 `unknown`으로 검사해요. 서버의 id·roomCode·name·maxMembers·status·ownerId·appointmentAt은 그대로 사용하고, 응답에 없는 myRole(OWNER)·memberCount(1)·selectedStation(null)만 생성 규칙으로 채워요. 가입 시각·멤버 상세는 만들지 않아요.
- 생성 요약과 코드를 같은 계정의 메모리 캐시에 반영해요. 생성 완료 화면의 표시·복사·공유는 응답의 `roomCode`를 사용해요. #106부터 이후 상세·초대 시트에서는 실제 7.9로 현재 코드를 조회해요. 가짜 코드는 만들지 않아요.
- 참여 코드는 `normalizeRoomCode`의 trim·대문자 변환 후 `isValidRoomCode`로 검사해요. 서버 입력 화면은 붙여넣기 전에 6자로 자르지 않으며, 내부 공백·기호·초과 글자를 임의로 삭제해 다른 유효 코드로 만들지 않아요. mock 입력은 기존 정리 동작을 유지해요.
- 참여 성공 응답의 UUID를 확인한 뒤 기존 상세 GET으로 실제 역할·멤버 수를 받아 캐시와 목록을 갱신해요. POST 성공 뒤 GET만 실패하면 참여 결과를 실패로 바꾸지 않고 상세 화면에서 조회를 재시도해요. 생성·참여 POST 자체를 자동 재전송하지 않아요. 기존 A-1의 인증 갱신·재시도와 공통 10초 제한은 유지해요.
- ROOM_CODE_INVALID(404)·ROOM_FULL/ALREADY_JOINED/ROOM_BUSY(409)·VALIDATION_ERROR(400)는 같은 RoomError 코드로, 네트워크·시간 초과는 NETWORK_ERROR로, 형식 오류·그 밖의 오류는 UNKNOWN_ERROR로 전달해요. TOKEN_*과 공통 인증 오류는 기존 A-1에 맡기며 화면에서 중복 안내하지 않아요.
- ALREADY_JOINED는 성공으로 바꾸거나 자동 이동하지 않아요. 서버 오류의 유효한 details.roomId 또는 이 계정에서 확인한 코드·ID가 있으면 사용자가 해당 방으로 이동할 수 있어요. Swagger 예시처럼 details가 비어 있고 코드·ID도 모르면 참여 중인 방 목록 버튼을 보여 줘요.
- 버튼 상태와 즉시 적용되는 ref로 빠른 연타·키보드 제출의 중복 요청을 막아요. 실패하면 입력을 유지하고 다시 누를 수 있어요. 화면을 떠난 뒤 늦은 응답으로 완료 화면이나 상세 이동을 실행하지 않아요. 계정이 바뀐 뒤 늦은 쓰기 응답은 이전 계정의 캐시·코드를 갱신하지 못해요. 생성·참여 전에 시작한 조회도 새 캐시를 덮거나 제거하지 못하며, 참여 후 상세는 이전 요청과 공유하지 않아요.
- 실서버 확인: 같은 계정으로 웹 로그인 후 POST /rooms 201과 응답 코드·목록·상세를 비교해요. 두 번째 계정으로 소문자·앞뒤 공백 코드를 입력해 POST /rooms/join 200과 2명 멤버를 확인해요. 404·정원 초과·이미 참여·처리 중은 자동 검사와 가능한 실서버 조건에서 확인해요. 임시 토큰 주입 코드는 확인 후 제거하며 커밋하지 않아요.

## 중간역 추천 (#99, 명세 8.1·8.2·8.3)

```ts
import { createRecommendation, fetchLatestRecommendation, fetchRecommendation, listRecommendationRuns } from '@/services/recommendation';

await createRecommendation(roomId, { conditionText: '환승 적게', filter: { maxMinutes: 30 } }); // POST /rooms/{roomId}/recommendations
await createRecommendation(roomId, {}); // 값이 없으면 body 는 {} 예요.
await fetchLatestRecommendation(roomId); // GET .../recommendations/latest, 실행 기록이 없으면 null
await fetchRecommendation(roomId, runId); // GET .../recommendations/{runId}
listRecommendationRuns(roomId); // 이 앱 세션에서 본 실행만, 최근 순
```

- 서버 모드는 BE 코드 기준 계약을 따라요. `roomId`·`runId`는 `encodeURIComponent`로 감싸요. 8.1 body는 공백을 뺀 `conditionText`와 값이 있는 `filter` 항목만 보내요(undefined·null·빈 배열 제외). 범위 검사는 서버가 해요(`VALIDATION_ERROR`).
- 서버 모드에서는 mock 계산(`MOCK_STATIONS`, `getMockRoom`·`getMockMembers`)을 타지 않아요. 추천역·주변 대안역 ID는 서버 값 그대로예요. 둘째·셋째 인자의 mock 옵션(`'error'`)은 mock 모드에서만 써요.
- 응답은 `unknown`으로 받아 화면이 읽는 값만 필수로 검사하고, 형식이 다르면 `UNKNOWN_ERROR`예요. 화면이 안 쓰는 값(`recommendedStation`의 좌표·`isSupported`, `metrics.totalTransfers`, `congestion.pct`, `segments[].direction`)은 없거나 달라도 통과해요. `segments`·`nearbyAlternatives`가 없으면 빈 배열이에요.
- `isStale`·`staleReasons`의 `null`(8.3 이전 실행, 판정 안 함)은 그대로 둬요. 화면은 `isStale === true`일 때만 "다시 추천받기" 안내를 보여요. 8.2의 `data: null`은 오류가 아닌 `null`이에요. 8.3이 `null`을 주면 형식 오류예요.
- `appliedConstraints`의 `null` 값·빈 배열은 빼서 정리해요. 모두 비면 `{}`이고 화면은 "적용된 제약 없음"을 보여요.
- `participantTimes[].congestion`은 데이터가 없으면 `null`이에요. 화면은 혼잡도 점·라벨과 안내의 "기준 혼잡도" 부분만 숨겨요. `boardingTrain`·`legs`·`source`·`arriveAt`·`slackSeconds`는 화면에 쓰지 않고 그대로 통과시켜요.
- 응답에 `recommendedStation.lines`가 없어서, 결과 최대 3곳을 역 상세(5.3 `fetchStation`)로 병렬 조회해 채워요(같은 역은 한 번). 실패하면 그 역의 노선 배지만 숨기고 결과는 그대로 보여요. 인증 오류는 그대로 던져요.
- 8.1만 `RECOMMENDATION_TIMEOUT_MS`(30초, 실서버 측정 전 임시값)를 쓰고, 조회는 기본 10초예요. 공통 클라이언트의 `RequestOptions.timeoutMs`로 요청별 제한 시간을 줄 수 있어요(생략하면 10초). 시간 초과도 `NETWORK_ERROR`라서 8.1 안내에 "결과가 저장됐을 수 있어요. 최근 결과를 확인해 보세요"를 넣어요. 화면에 다시 들어오면 8.2로 확인돼요.
- 오류는 `RecommendationError`로 바꿔요: `TOO_FEW_MEMBERS`·`DEPARTURE_MISSING`(`error.details.missingUserIds`가 문자열 배열일 때만 `missingUserIds`로 전달)·`STATION_UNSUPPORTED`·`APPOINTMENT_PASSED`·`NO_SERVICE_TIME`(422), `RECOMMENDATION_IN_PROGRESS`(409), `NOT_ROOM_MEMBER`(403), `ROOM_NOT_FOUND`·`RUN_NOT_FOUND`(404), `VALIDATION_ERROR`(400), `NETWORK_ERROR`. 모르는 코드와 형식 오류는 `UNKNOWN_ERROR`예요. `TOKEN_*`·401은 `ApiError` 그대로 A-1에 맡기고 화면에서 따로 안내하지 않아요.
- 서버에 이전 실행 목록 API가 없어서 `listRecommendationRuns`는 이 앱 세션의 8.1 성공·8.2 결과만 중복 없이 최근 순으로 돌려줘요. 화면은 2건 이상일 때만 "이전 추천 기록"을 보여요.
- 요청 전 `getRoomCacheScope()`로 계정 범위를 잡고 응답 뒤 `assertRoomCacheScope()`로 확인해요. 계정이 바뀐 뒤의 늦은 응답은 `AUTH_REQUIRED`로 버려요. 계정이 바뀌면(`subscribeRoomCacheReset`) 이전 실행 목록도 비워요.
- 화면은 8.1 요청 중 계산 버튼과 "다시 추천받기"를 막고, 상태가 반영되기 전 연타도 한 번만 보내요.
- 추천 → 후보 올리기는 #101부터 서버 7.14를 불러요(아래 "약속역 후보" 항목). WS 수신 재조회와 새 필드 화면 표시는 범위 밖이에요.

## 약속역 후보 제안·목록·삭제·투표 (#101, 명세 7.14~7.17)

```ts
import { createProposal, deleteProposal, fetchProposals, voteProposal } from '@/services/room';

await fetchProposals(roomId); // GET /rooms/{roomId}/station-proposals → { selectedStation, maxProposals, items } (최신순)
await createProposal(roomId, stationId); // POST … { stationId }
await createProposal(roomId, stationId, resultId); // POST … { stationId, resultId } (추천 결과·주변 대안역)
await voteProposal(roomId, proposalId); // PUT …/{proposalId}/vote (body 없음, 같은 후보 재요청은 멱등)
await deleteProposal(roomId, proposalId); // DELETE …/{proposalId} → data: null
```

- room.ts의 후보 함수 4개는 서버 모드에서 `services/room-proposals.ts`만 불러요(요청·파서·오류 변환은 그 파일). mock 저장소(`proposalsByRoom`, `MOCK_STATIONS`)와 mock 인자(`'error'`·`'busy'`)는 mock 모드에서만 써요. 제안 전 역 상세(5.3)로 미리 확인하지 않고 서버 판단에 맡겨요.
- `roomId`·`proposalId`는 `encodeURIComponent`로 감싸요. 7.14 body는 `{ stationId }`이고 `resultId`는 값이 있을 때만 넣어요. 잘못된 역 ID는 요청 없이 `STATION_NOT_FOUND`예요.
- 응답은 `unknown`으로 받아 화면이 읽는 값만 필수로 검사하고, 형식이 다르면 `UNKNOWN_ERROR`예요. 목록 항목은 `id`·`station{id,name}`·`isSelected`·`voteCount`·`votedByMe`·`createdAt`이 필수예요. 같은 `id`가 두 번 오면 형식 오류예요.
- 서버 `station`·`selectedStation`은 `{ id, name }`만 와요. `lines`는 빈 배열(노선 배지 숨김), `isSupported`는 `true`로 채우고 역 상세를 추가로 조회하지 않아요. `maxProposals`가 없으면 9예요. `resultId`가 비면 `null`이에요.
- 제안자 닉네임이 없음·null·빈 문자열이면 `"알 수 없음"`이에요(`UNKNOWN_PROPOSER_NAME`). 후보 패널은 "알 수 없음 제안"으로 보여요. `userId`가 없으면 빈 문자열이라 "내가 제안"·삭제 권한에 걸리지 않아요.
- 7.14 응답에는 `isSelected`·`voteCount`·`votedByMe`가 없어서 `false`·`0`·`false`로 채워요. 화면은 제안·투표·삭제 뒤 7.15로 목록을 다시 맞춰요. 7.16의 `data: null`과 빈 본문은 정상이에요.
- 오류는 `RoomError`로 바꿔요: `ALREADY_PROPOSED`·`ALREADY_VOTED`·`ROOM_BUSY`(409), `PROPOSAL_LIMIT_EXCEEDED`·`STATION_UNSUPPORTED`(422), `NOT_PROPOSAL_OWNER`·`NOT_ROOM_MEMBER`(403), `PROPOSAL_NOT_FOUND`·`STATION_NOT_FOUND`·`RESULT_NOT_FOUND`·`ROOM_NOT_FOUND`(404), `NETWORK_ERROR`(동작별 문구). 모르는 코드와 형식 오류는 `UNKNOWN_ERROR`예요. 문구는 기존 mock 문구를 쓰고, 역 이름이 들어가던 문구(중복·미지원)와 `RESULT_NOT_FOUND`·`UNKNOWN_ERROR`·삭제 실패만 새로 정했어요.
- `NOT_ROOM_MEMBER`·`ROOM_NOT_FOUND`는 그 계정의 방 캐시를 비워요(`removeCachedRoom`). 방 상세는 기존 접근 불가 화면(약속방 목록으로 이동 버튼)을, 추천 화면은 기존 접근 불가 화면을 보여줘요.
- 요청 전 `getRoomCacheScope()`로 계정 범위를 잡고 성공·실패 응답 뒤 `assertRoomCacheScope()`로 확인해요. 다른 계정으로 바뀐 뒤의 늦은 응답은 `AUTH_REQUIRED`로 버리고 새 계정의 방 캐시를 지우지 않아요. 화면 간 늦은 응답은 기존 요청 번호로 막아요.
- `TOKEN_*`·401은 `ApiError` 그대로 A-1에 맡기고 후보 패널·방 상세·추천 화면에서 따로 안내하지 않아요.
- 투표는 참고용이에요(자동 확정 없음). 삭제 버튼은 방장이거나 내가 제안한 후보일 때만 보여요. 최종 약속역 지정·해제(7.10·7.11)와 WS 실시간 갱신은 범위 밖이에요.

## 초대 코드·출발역·방 정보 수정 (#106)

- `fetchInviteCode(roomId)`는 서버 모드에서 `GET /rooms/{roomId}/invite-code`를 호출해요. 로컬 생성 기록이나 캐시 역할로 미리 거절하지 않고 현재 서버 권한으로 확인해요. 응답은 `{ roomCode: 대문자 영문·숫자 6자 }`로 검사해 서버 캐시에 보관해요. 앱 재시작 뒤에도 현재 방장은 조회할 수 있어요.
- `updateMyDeparture(roomId, { departureStationId })`는 정수 ID 하나만 `PATCH /rooms/{roomId}/members/me`로 보내요. null·누락·문자열·소수·JS에서 안전하지 않은 정수는 요청 전에 VALIDATION_ERROR예요. 서버 모드에서는 mock 역 목록을 조회하거나 요청의 역으로 가짜 멤버를 만들지 않아요.
- `updateRoom(roomId, patch)`는 `PATCH /rooms/{roomId}`로 선택한 name·appointmentAt만 보내요. 이름은 기존 trim·코드 포인트 1~30자로 검사해요. name:null은 오류, appointmentAt:null은 해제이며 생략은 유지예요. 빈 body도 허용해요. 지정한 시각은 시간대 있는 미래 ISO인지 검사하고 UTC로 보내요.
- 두 PATCH의 성공 data는 반드시 null이어야 해요. 출발역은 기존 멤버 GET, 방 정보는 기존 상세 GET으로 다시 받아 공용 캐시와 목록에 반영해요. 서버 모드 반환은 void예요. mock에서는 기존 멤버/방 객체 반환을 유지하므로 공개 반환 타입은 각각 `Promise<RoomMember | void>`, `Promise<RoomSummary | void>`예요. 현재 호출 화면은 반환 객체를 사용하지 않아요.
- PATCH가 성공하고 GET만 실패하면 "변경은 저장했지만 최신 정보를 불러오지 못했어요"라고 안내해요. 서비스 자체의 PATCH·GET 자동 재시도는 추가하지 않아요. 기존 공통 10초 제한과 A-1 인증 갱신 규칙은 유지해요.
- NOT_ROOM_OWNER·NOT_ROOM_MEMBER·ROOM_NOT_FOUND·ROOM_BUSY·STATION_NOT_FOUND·STATION_UNSUPPORTED·VALIDATION_ERROR는 같은 RoomError 코드로 연결해요. 형식 오류·그 밖의 오류는 UNKNOWN_ERROR, 네트워크·시간 초과는 NETWORK_ERROR예요. TOKEN_*·401은 ApiError 그대로 A-1에 맡기고 화면에서 중복 안내하지 않아요.
- 비멤버·없는 방 응답은 대상 방 캐시를 제거해요. NOT_ROOM_OWNER는 이전 초대 코드 캐시를 지워요. 비멤버 화면은 목록으로 이동하고 수정 권한 상실은 방장 전용 안내를 보여 줘요. 초대 시트에서 권한이 바뀌면 상세를 재조회해 헤더 권한도 갱신해요.
- 변경·조회 전후 `sessionGeneration:userId` 범위를 검사해요. 쓰기 전에 시작된 조회는 새 캐시를 덮거나 삭제하지 못해요. 화면의 ref 잠금과 조회 번호로 연타, 닫힌 시트, 화면 이탈, 다른 방·계정으로 전환한 뒤의 늦은 응답과 예약 이동을 막아요.
- 수정 화면은 바꾼 필드만 보내고, 기존 약속 시각의 초·밀리초 차이만으로 시각이 바뀌었다고 판단하지 않아요. 이름만 바꾸면 기존 시각은 그대로 유지해요. 과거 시각은 입력 단계에서도 먼저 막아요.
- mock 모드는 기존 기능·실패 플래그·객체 반환을 유지해요. 추천·후보·투표·확정 약속역을 새로 만들거나 지우는 API는 호출하지 않아요. 나가기·승계·약속역 지정/해제·WebSocket은 이번 범위 밖이에요.

## 홈 "다가오는 약속" (#102, 명세 7.3)

```ts
import { fetchMyRooms } from '@/services/room';
import { pickUpcomingRoom, toHomeMeeting, meetingRoomParams } from '@/utils/upcoming-meeting';

const room = pickUpcomingRoom(await fetchMyRooms(), new Date()); // 지나지 않은 가장 가까운 약속, 없으면 null
const card = room ? toHomeMeeting(room) : null; // 방 이름·약속 시각·약속역(없으면 "약속역 미정")·인원
```

- 홈 전용 API는 없어요. 서버 모드 홈은 기존 7.3 방 목록(`fetchMyRooms`)만 써요. mock 모드는 `constants/home-mock.ts`의 `HOME_UPCOMING_MEETING`을 그대로 쓰고 서버를 부르지 않아요.
- `pickUpcomingRoom`: 약속 시각이 없거나 읽을 수 없는 방, 이미 지난 방은 빼고 가장 가까운 방 하나를 골라요(같은 시각이면 목록 순서). 남은 방이 없으면 빈 상태("예정된 약속이 없어요")예요.
- 카드를 누르면 약속방 목록의 `openRoom`과 같은 params(`roomId`·`roomName`·`appointmentAt`·`maxMembers`)로 방 상세에 가요.
- 홈에 들어올 때마다 다시 불러오되, 같은 계정에서 이미 보여주던 카드는 로딩으로 되돌리지 않아요. 화면을 떠난 뒤 온 응답과 로그인 세대가 바뀐 뒤 온 응답은 버려요. 결과는 계정(로그인 세대:userId, room-cache 범위와 같은 기준)과 함께 들고 있어서, 계정이 바뀌면 다시 불러오기 전에도 이전 계정의 방을 보여주지 않아요.
- 로딩은 카드 자리의 불러오는 중 표시, 서버 오류는 "약속을 불러오지 못했어요"와 눌러서 다시 시도예요. 경로 탐색·AI 표지판·약속방 버튼은 그대로 쓸 수 있어요. 인증 오류(`TOKEN_*`·401)는 화면 안내 없이 A-1 흐름에 맡겨요.
- 홈의 지도 그림(MockMap)은 지도 표시(B-4) 범위라 그대로예요. 도착정보·혼잡도 영역은 홈에 없어서 이번에 추가하지 않았어요.

## 방 나가기·방장 승계·최종 약속역 (#107, 명세 7.7·7.10·7.11)

```ts
import { leaveRoom, setSelectedStation } from '@/services/room';

const result = await leaveRoom(roomId); // DELETE /rooms/{roomId}/members/me, body 없음
// result: { roomDeleted: boolean, newOwnerId: 사용자 UUID | null }
await setSelectedStation(roomId, supportedStation); // PUT …/selected-station { stationId }
await setSelectedStation(roomId, null); // DELETE …/selected-station, body 없음
```

- 서버 모드는 `room-query.ts`가 요청·unknown 응답 검사·계정 가드·캐시 갱신을 담당해요. mock 분기는 기존 동작·실패 플래그를 유지해요.
- 나가기 결과의 삭제 여부와 새 방장은 서버 값만 사용해요. `newOwnerId`는 사용자 UUID예요. 방 삭제와 승계가 동시에 오거나 자신에게 승계하는 등 잘못된 응답은 UNKNOWN_ERROR예요. 성공하면 공용 캐시의 해당 방·멤버·초대 코드를 제거해요.
- 나가기 403 NOT_ROOM_MEMBER·404 ROOM_NOT_FOUND도 캐시를 비우고 '이미 나간 방이거나 삭제된 약속방'으로 안내해요. 응답 유실 후 사용자가 재시도한 경우에도 정리할 수 있어요. 네트워크 오류·ROOM_BUSY만으로는 방을 먼저 지우지 않아요. 목록 이동 시 기존 상세 화면 기록도 정리해요.
- 서버 나가기 확인창은 mock 사용자 ID를 사용하지 않아요. 현재 멤버 목록으로 마지막 멤버 여부를 안내하되, 승계할 이름을 계산하지 않고 서버의 입장 순서를 안내해요. 최종 성공 문구는 응답의 newOwnerId로 표시해요.
- 약속역 지정은 안전한 정수 stationId 하나만 보내요. null 역은 해제를 뜻하지만 `{ id: null }`처럼 잘못된 역 객체는 VALIDATION_ERROR예요. 후보 등록 여부·표 수·mock 역 목록으로 서버 역 ID를 제한하지 않아요. 현재 OWNER 여부와 지원 여부는 서버가 최종 판단해요.
- PUT·DELETE는 반드시 200 data:null 응답을 검사한 뒤 방 상세 GET으로 selectedStation·status·confirmedAt을 갱신해요. 같은 역 재지정의 confirmedAt도 서버 값을 그대로 사용하며 '확정 시각을 갱신했어요'로 안내해요. 이미 미확정인 역의 해제도 서비스에서는 DELETE를 보내고 성공으로 처리해요.
- 기존 후보·투표·약속 시각을 지우거나 계산하지 않아요. 화면은 성공 후 상세·후보 목록을 다시 조회하고, 방 목록·홈은 복귀 시 기존 조회로 갱신해요.
- ROOM_BUSY·NOT_ROOM_OWNER·NOT_ROOM_MEMBER·ROOM_NOT_FOUND·STATION_UNSUPPORTED·STATION_NOT_FOUND·VALIDATION_ERROR를 구분해요. 형식 오류·알 수 없는 오류는 UNKNOWN_ERROR, 네트워크·기존 10초 제한은 NETWORK_ERROR예요. TOKEN_*·401은 기존 A-1에 맡겨 중복 안내하지 않아요.
- sessionGeneration:userId 범위를 요청 전후 검사하고, 같은 계정·방의 나가기/약속역 변경 연타를 막아요. 나가기 전에 시작한 목록·상세·멤버 조회는 제거한 방을 캐시에 되살리지 못해요. 계정·방 변경·화면 이탈 뒤 늦은 응답은 이전 화면의 성공 문구·이동을 실행하지 않아요. 화면 복귀 시 처리 중 버튼도 해제해요.
- 서버 성공 뒤 상세 GET만 실패하면 '변경은 저장했지만 최신 정보를 불러오지 못했어요'라고 안내해요. 자동 재전송은 추가하지 않아요. 재저장 시 같은 역의 confirmedAt이 다시 갱신될 수 있어요.
- BE 실시간 이벤트·SYSTEM 메시지·WebSocket, 후보·투표 API 변경은 범위 밖이에요. 기존 채팅의 mock SYSTEM 메시지가 실제 서버 이벤트를 수신한 것은 아니에요.
