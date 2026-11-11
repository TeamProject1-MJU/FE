# 서비스에서 쓰는 법

`.env.example`을 `.env`로 복사합니다. `EXPO_PUBLIC_USE_MOCK`은 생략하면 `true`이고, 정확히 `true`일 때만 mock입니다. 서버를 쓰려면 `false`와 `/api/v1`까지 포함한 `EXPO_PUBLIC_API_BASE_URL`을 설정하고 앱을 완전히 새로고침합니다. 환경변수는 빌드에 포함되므로 토큰은 넣지 않습니다.

현재 인증, 내 정보·닉네임 수정·탈퇴(`services/user.ts`), 역 검색·역 상세·노선 목록(`services/station.ts`), 혼잡도 조회(`services/congestion.ts`), 경로 검색(`services/route.ts`), 실시간 도착정보(`services/arrivals.ts`)가 서버 모드를 지원해요.

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
- `STATION_UNSUPPORTED`(422), `ROUTE_NOT_FOUND`·`STATION_NOT_FOUND`(404)는 같은 `RouteSearchError` 코드, 네트워크·시간 초과는 `NETWORK_ERROR`, 나머지는 `EXTERNAL_API_ERROR`로 전달해요. `TOKEN_*`과 공통 인증 오류는 `ApiError` 그대로 전달하고 화면에서 중복 안내하지 않아요.
- mock 모드의 기존 경로·대기·도착 시각 생성은 유지해요. 방 화면 호출 연결, 출발 시각 선택, 지도와 추천 API는 이번 범위 밖이에요. 실시간 도착정보는 아래 항목에서 다뤄요.

## 실시간 도착정보 (#95, 명세 6.3)

```ts
import { fetchArrivals } from '@/services/arrivals';
import { formatNextTrain } from '@/components/route/format';

// GET /stations/222/arrivals?lineId=2&nextStationId=223&directionCode=INNER&limit=2
const data = await fetchArrivals({ stationId: 222, lineId: 2, nextStationId: 223, directionCode: 'INNER', limit: 2 });
if (data.available) {
    const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(data.receivedAt!)) / 1000));
    data.trains.map(train => formatNextTrain(train, elapsed)); // "성수행 2분 5초" · "성수행 곧 도착" · "성수행 · [2]번째 전역"
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
  - `secondsUntil`이 null일 때만 `message`를 시간 대신 "성수행 · [2]번째 전역"처럼 보여줘요. `message`가 이미 "성수행"으로 시작하면 행선지는 한 번만 나와요. `message`도 비어 있으면 "성수행"만 보여줘요.
  - 행선지는 `formatDestination`으로 "성수" → "성수행"처럼 "행"을 붙여요. 이미 "행"으로 끝나면 붙이지 않아요.
- `NextTrains`는 화면에 들어올 때 바로 한 번, 이후 20초마다 불러요(서버가 역·노선별 10~20초 캐시와 일일 한도가 있어 15~30초를 지켜요). 이전 요청이 끝나지 않았으면 다음 폴링을 건너뛰어요. `available: false`·열차 없음·`receivedAt`을 읽을 수 없음·호출 실패(`UNKNOWN_ERROR` 포함)는 줄을 숨기고, 인증 오류는 이전 값을 그대로 둬요. 토큰을 갱신하는 동안에는 요청이 끝나지 않아 이전 값이 계속 보여요.
- mock 모드는 기존 동작을 유지하고 서버를 부르지 않아요. mock 응답도 실서버와 같은 필드 이름이고 `message`에 "3분 2초 후" 같은 문구를 채워요. 둘째 인자 `'none'`(available:false)·`'fail'`(호출 실패)은 mock 모드에서만 쓰고 서버 모드에서는 무시해요. 안내 화면 주소에 `&arrivals=none` 또는 `&arrivals=fail`을 붙여 확인해요.
- 경로 검색(6.1)의 대기 필드(`waitSec`, `nextTrains`) 표시는 이번 범위가 아니에요.
