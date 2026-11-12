/**
 * CSS import 타입 선언 (#103)
 * - Expo 가 만드는 expo-env.d.ts(git 에 안 올라가요)에도 같은 선언이 있지만,
 *   그 파일이 없는 새 체크아웃에서도 `npx tsc --noEmit` 이 통과하도록 여기 둬요.
 * - '*.module.css': 웹 전용 CSS 모듈(components/animated-icon.web.tsx). 클래스 이름 → 문자열.
 * - '*.css': 부수 효과 import(constants/theme.ts 의 '@/global.css'). 내보내는 값은 없어요.
 */
declare module '*.module.css' {
    const classes: { readonly [key: string]: string };
    export default classes;
}

declare module '*.css';
