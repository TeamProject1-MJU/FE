export const WEB_APP_WIDTH = 393;
export const WEB_APP_HEIGHT = 852;

export function webAppScale(width: number, height: number) {
    return Math.min(0.9, width / WEB_APP_WIDTH, height / WEB_APP_HEIGHT);
}
