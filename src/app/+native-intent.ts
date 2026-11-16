// 카카오톡 로그인 복귀 주소(…://oauth?code=…)는 네이티브 SDK가 처리해요. 라우터는 이동하지 않아요.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
    if (/^kakao[0-9a-f]+:\/\/oauth/i.test(path) || /^[a-z+.-]+:\/\/oauth\?/i.test(path)) return null;
    return path;
}
