/** Bottom-bar replacements skip animation; contextual pushes retain their transition and back stack. */
export function tabScreenOptions({ route }: { route: { params?: unknown } }) {
    const tabSwitch = (route.params as { tabSwitch?: string } | undefined)?.tabSwitch === '1';
    return { animation: tabSwitch ? 'none' as const : 'default' as const, animationTypeForReplace: 'push' as const };
}
