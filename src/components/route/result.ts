import type { Route } from '@/types/route';
import { routeDurationSec } from '@/components/route/format';

const duration = (route: Route) => routeDurationSec(route.summary);

export function sortRoutes(routes: Route[]) {
    return [...routes].sort((a, b) => duration(a) - duration(b) || a.summary.transferCount - b.summary.transferCount);
}

/** Award each badge only to the unique minimum for that criterion. */
export function routeBadges(route: Route, routes: Route[]): string[] {
    if (routes.length <= 1) return [];
    const criteria: [string, (route: Route) => number][] = [
        ['최소시간', duration],
        ['최소환승', route => route.summary.transferCount],
        ['최저요금', route => route.summary.fare],
    ];
    return criteria.filter(([, value]) => {
        const current = value(route);
        return routes.every(other => current <= value(other))
            && routes.filter(other => current === value(other)).length === 1;
    }).map(([label]) => label);
}
