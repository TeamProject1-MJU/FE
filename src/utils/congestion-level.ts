import type { Congestion } from '@/types/route';

export const LEVEL_ORDER = ['COMFORTABLE', 'RELAXED', 'NORMAL', 'CROWDED', 'VERY_CROWDED'] as const;

/** Same block scale used by the route timeline: unavailable 0, comfortable 1–very crowded 5. */
export function blockLevel(congestion: Pick<Congestion, 'supported' | 'level'> | null | undefined) {
    const level = congestion?.supported ? congestion.level : null;
    return level ? LEVEL_ORDER.indexOf(level) + 1 : 0;
}
