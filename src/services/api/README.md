# 서비스에서 쓰는 법

`.env.example`을 `.env`로 복사합니다. `EXPO_PUBLIC_USE_MOCK`은 생략하면 `true`이고, 정확히 `true`일 때만 mock입니다. 서버를 쓰려면 `false`와 `/api/v1`까지 포함한 `EXPO_PUBLIC_API_BASE_URL`을 설정하고 앱을 완전히 새로고침합니다. 환경변수는 빌드에 포함되므로 토큰은 넣지 않습니다.

현재 전환이 적용된 서비스는 역 검색뿐입니다. 나머지 서비스는 기존 mock을 유지합니다.

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
        console.warn(error.code, error.message, error.status, error.details);
    } else {
        throw error;
    }
}
```

`get`, `post`, `put`, `patch`, `delete`를 제공합니다. 본문이 있는 메서드는 `(경로, 본문, 옵션)`, 나머지는 `(경로, 옵션)`으로 호출합니다. 응답은 공통 봉투의 `data`만 반환하며, 본문이 없는 성공은 `undefined`입니다. `query`의 `null`·`undefined`는 제외하고, 요청과 응답 본문 읽기에 10초 제한을 적용합니다. 네트워크·시간 초과는 `NETWORK_ERROR`, JSON 파싱·응답 형식 오류는 `UNKNOWN_ERROR`입니다.

## 토큰 주입 자리

```ts
import { setAccessTokenProvider, post } from '@/services/api/client';

// 향후 인증 모듈이 가진 토큰 조회 함수를 연결합니다. 비동기 함수도 가능합니다.
const readCurrentAccessToken = (): string | null => null;
setAccessTokenProvider(readCurrentAccessToken);

// 인증이 필요 없는 요청은 auth: false로 헤더를 생략합니다.
// await post('/auth/kakao', 요청본문, { auth: false });

// 연결 해제
setAccessTokenProvider(null);
```

토큰이 있을 때만 `Authorization: Bearer ...`를 붙입니다. 쿠키 옵션, 토큰 저장, 로그인 구현, 401 갱신·재시도는 포함하지 않습니다.

## 역 검색

```ts
import { searchStations } from '@/services/station';

const result = await searchStations(' 강남 ', { lineId: 2, page: 0, size: 50 });
// result: { items, page, size, totalElements }
```

빈 검색어는 서버를 호출하지 않고 빈 결과를 반환합니다. 페이지는 0 이상, 크기는 1~50으로 제한합니다. mock에서도 기존 이름 정규화·정렬·미제공 역을 유지하며 노선과 페이지 옵션을 적용합니다.

실행 검사는 프로젝트 루트에서 `node --test scripts/verify-api-client.cjs`로 돌립니다. 실제 서버와 추가 패키지 없이 응답·오류·인증 헤더·시간 초과·mock 검색을 확인합니다.
