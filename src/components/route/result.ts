import type { Route } from '@/types/route';

const duration = (route: Route) => route.summary.totalWithWaitSec ?? route.summary.totalTimeSec;

export function sortRoutes(routes: Route[]) {
    return [...routes].sort((a, b) => duration(a) - duration(b) || a.summary.transferCount - b.summary.transferCount);
}

/** Compare raw seconds (the same source used for displayed duration), including ties. */
export function routeBadges(route: Route, routes: Route[]): string[] {
    if (routes.length <= 1) return [];
    const criteria: [string, (route: Route) => number][] = [
        ['최소시간', duration],
        ['최소환승', route => route.summary.transferCount],
        ['최저요금', route => route.summary.fare],
    ];
    return criteria.filter(([, value]) => routes.every(other => value(route) <= value(other))).map(([label]) => label);
}
