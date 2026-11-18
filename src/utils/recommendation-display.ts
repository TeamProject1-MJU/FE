import type { NearbyAlternative } from '@/types/recommendation';

export type NearbyAlternativeGroup = {
    station: NearbyAlternative['station'];
    lineIds: number[];
    alternatives: NearbyAlternative[];
};

/** 같은 역 ID만 묶어요. 노선·관계·수치가 다른 대안은 버리거나 합산하지 않아요. */
export function groupNearbyAlternatives(items: readonly NearbyAlternative[]): NearbyAlternativeGroup[] {
    const groups = new Map<number, NearbyAlternativeGroup>();
    const seen = new Map<number, Set<string>>();
    for (const alternative of items) {
        let group = groups.get(alternative.station.id);
        if (!group) {
            group = { station: alternative.station, lineIds: [], alternatives: [] };
            groups.set(alternative.station.id, group);
            seen.set(alternative.station.id, new Set());
        }
        const signature = JSON.stringify([alternative.lineId, alternative.relation,
            alternative.relationLabel, alternative.maxMinutes, alternative.totalFareWon]);
        if (seen.get(alternative.station.id)!.has(signature)) continue;
        seen.get(alternative.station.id)!.add(signature);
        if (!group.lineIds.includes(alternative.lineId)) group.lineIds.push(alternative.lineId);
        group.alternatives.push(alternative);
    }
    return [...groups.values()];
}
