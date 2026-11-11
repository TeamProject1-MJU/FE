/** 원본 이름은 유지하고 화면에 표시할 때만 역을 붙여요. */
export function formatStationName(name: string | null | undefined): string {
    const trimmed = name?.trim() ?? '';
    return !trimmed || trimmed.endsWith('역') ? trimmed : `${trimmed}역`;
}
