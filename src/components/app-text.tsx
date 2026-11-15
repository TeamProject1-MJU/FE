import type { ComponentPropsWithRef } from 'react';
import {
  Platform,
  Text as RNText,
  TextInput as RNTextInput,
  type StyleProp,
  type TextStyle,
} from 'react-native';

/**
 * 앱 기본 글꼴(Pretendard)을 입힌 Text·TextInput 이에요. (#187)
 * - 네이티브: app.json 의 expo-font 플러그인이 앱에 심은 'Pretendard' family 를 써요.
 * - 웹: src/global.css 의 @font-face 'Pretendard' 를 쓰고, 뒤에 시스템 글꼴 fallback 을 둬요.
 * react-native 의 Text·TextInput 과 같은 이름으로 내보내서 import 경로만 바꾸면 돼요.
 */
const FONT_FAMILY = Platform.select({
  web: "Pretendard, ui-sans-serif, system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
  default: 'Pretendard',
});

const FONT_STYLE: TextStyle = { fontFamily: FONT_FAMILY };

/** style 안 어디든(중첩 배열 포함) fontFamily 가 지정돼 있으면 true 예요. */
function hasFontFamily(style: unknown): boolean {
  if (Array.isArray(style)) return style.some(hasFontFamily);
  return !!style && typeof style === 'object' && 'fontFamily' in style && (style as TextStyle).fontFamily != null;
}

/**
 * 원래 style 의 순서·위치는 그대로 두고 글꼴 스타일을 맨 뒤에만 덧붙여요.
 * 원래 style 에 fontFamily 가 있으면 손대지 않고 그대로 돌려줘요(원래 값 우선).
 */
function withAppFont(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  if (hasFontFamily(style)) return style;
  if (style == null || style === false) return FONT_STYLE;
  return Array.isArray(style) ? [...style, FONT_STYLE] : [style, FONT_STYLE];
}

export type TextProps = ComponentPropsWithRef<typeof RNText>;
export type TextInputProps = ComponentPropsWithRef<typeof RNTextInput>;

/** ref 타입으로 쓸 수 있게 react-native 의 인스턴스 타입을 같은 이름으로 내보내요. */
export type Text = RNText;
export type TextInput = RNTextInput;

export function Text({ style, ...props }: TextProps) {
  return <RNText {...props} style={withAppFont(style)} />;
}

export function TextInput({ style, ...props }: TextInputProps) {
  return <RNTextInput {...props} style={withAppFont(style)} />;
}
