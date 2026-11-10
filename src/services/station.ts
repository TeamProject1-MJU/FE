import { get } from '@/services/api/client';
import { useMock as isMockMode } from '@/services/api/config';
import type { StationSearchOptions, StationSearchResult } from '@/types/station';

export async function searchStations(keyword: string, options: StationSearchOptions = {}): Promise<StationSearchResult> {
    const query = keyword.trim();
    const page = Number.isFinite(options.page) ? Math.max(0, Math.trunc(options.page!)) : 0;
    const size = Number.isFinite(options.size) ? Math.max(1, Math.min(50, Math.trunc(options.size!))) : 50;
    if (!query) return { items: [], page, size, totalElements: 0 };

    if (isMockMode()) {
        // 공유 mock 데이터를 옮기지 않고 기존 검색 순서를 재사용합니다. 호출 시에만 읽어 초기 순환 참조를 피합니다.
        const { searchStations: searchMockStations } = await import('@/app/station-search');
        const matches = searchMockStations(query, Number.MAX_SAFE_INTEGER)
            .filter(station => options.lineId === undefined || station.lines.some(line => line.lineId === options.lineId));
        return { items: matches.slice(page * size, (page + 1) * size), page, size, totalElements: matches.length };
    }

    return get<StationSearchResult>('/stations', { query: { keyword: query, lineId: options.lineId, page, size } });
}
