import { isCoordinate, isMapBounds, type MapBounds } from '@/utils/home-map';

/** 지도로 보내는 메시지 상한. 앱(route-map)이 이 안으로 줄여 보내고, 넘는 메시지는 지도가 통째로 무시해요. */
export const MAP_LIMITS = { markers: 500, lines: 50, linePoints: 1000, totalPoints: 5000 } as const;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export function isHexColor(value: unknown): value is string {
    return typeof value === 'string' && HEX_COLOR.test(value);
}
/** 선 목록 검증: id 는 안전한 정수, color 는 #RRGGBB, 점은 2개 이상이고 모두 좌표 범위 안, 개수 상한. */
export function isValidMapLines(lines: unknown): boolean {
    if (!Array.isArray(lines) || lines.length > MAP_LIMITS.lines) return false;
    let total = 0;
    for (const line of lines) {
        if (!line || typeof line !== 'object') return false;
        const l = line as Record<string, unknown>;
        if (!Number.isSafeInteger(l.id) || !isHexColor(l.color) || !(l.dashed === undefined || typeof l.dashed === 'boolean')) return false;
        if (!Array.isArray(l.points) || l.points.length < 2 || l.points.length > MAP_LIMITS.linePoints || !l.points.every(isCoordinate)) return false;
        total += l.points.length;
        if (total > MAP_LIMITS.totalPoints) return false;
    }
    return true;
}

export type MapMessage = { type: 'ready' } | { type: 'error' } | { type: 'region'; bounds: MapBounds };
export function parseMapMessage(raw: string): MapMessage | null {
    try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object') return null;
        const v = value as Record<string, unknown>;
        if (v.type === 'ready' || v.type === 'error') return { type: v.type };
        if (v.type === 'region' && isMapBounds(v.bounds)) return { type: 'region', bounds: v.bounds };
    } catch { /* 잘못된 메시지는 무시해요. */ }
    return null;
}

export function isAllowedMapNavigation(url: string) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
            && (u.hostname === 'localhost' || u.hostname === 'kakao.com' || u.hostname.endsWith('.kakao.com'));
    } catch { return false; }
}

/**
 * 위치·역·경로 데이터는 HTML에 삽입하지 않고 검증된 JSON 메시지로만 전달해요.
 * state 메시지: { type, center, myLocation, markers[{ id, latitude, longitude, isSupported, color? }], revision,
 *   lines?[{ id, color, points[{ latitude, longitude }], dashed? }], fit?{ bounds, revision } }
 * 선택 값(lines, fit, marker.color)이 없으면 홈 지도와 같은 메시지·동작이에요.
 */
export function buildMapHtml(key: string): string {
    const sdkUrl = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key).replace(/'/g, '%27')}&autoload=false`;
    return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; form-action 'none'; base-uri 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://*.kakao.com https://*.daum.net https://*.daumcdn.net; style-src 'unsafe-inline'; img-src data: https://*.kakao.com https://*.daumcdn.net https://*.daum.net; connect-src https://*.kakao.com https://*.daum.net https://*.daumcdn.net">
<style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden}.dot{width:16px;height:16px;border:3px solid white;border-radius:50%;box-shadow:0 1px 4px #555;pointer-events:none}</style></head>
<body><div id="map"></div><script>
(function(){
 var map, overlays=[], polylines=[], mine=null, lastCenter=null, lastFit=null;
 window.open=function(){return null;};
 // 지도는 외부 링크를 열지 않아요(저작권 링크도 앱 밖으로 보내지 않아요).
 document.addEventListener('click',function(e){var el=e.target;while(el && el.tagName!=='A')el=el.parentElement;if(el)e.preventDefault();},true);
 function send(v){window.ReactNativeWebView.postMessage(JSON.stringify(v));}
 function fail(){send({type:'error'});}
 window.addEventListener('error',fail);
 function point(p){return p && typeof p.latitude==='number' && Number.isFinite(p.latitude) && Math.abs(p.latitude)<=90 && typeof p.longitude==='number' && Number.isFinite(p.longitude) && Math.abs(p.longitude)<=180;}
 function color(c){return typeof c==='string' && /^#[0-9a-fA-F]{6}$/.test(c);}
 function lines(ls){
  if(!Array.isArray(ls) || ls.length>${MAP_LIMITS.lines}) return false;
  var total=0;
  for(var i=0;i<ls.length;i++){var l=ls[i];
   if(!l || !Number.isSafeInteger(l.id) || !color(l.color) || !(l.dashed===undefined || typeof l.dashed==='boolean') || !Array.isArray(l.points) || l.points.length<2 || l.points.length>${MAP_LIMITS.linePoints} || !l.points.every(point)) return false;
   total+=l.points.length; if(total>${MAP_LIMITS.totalPoints}) return false;
  }
  return true;
 }
 function fit(f){var b=f && f.bounds;return Number.isSafeInteger(f && f.revision) && b && [b.minLng,b.minLat,b.maxLng,b.maxLat].every(function(n){return typeof n==='number' && Number.isFinite(n);}) && b.minLng>=-180 && b.maxLng<=180 && b.minLat>=-90 && b.maxLat<=90 && b.minLng<b.maxLng && b.minLat<b.maxLat;}
 function coordinate(p){return new kakao.maps.LatLng(p.latitude,p.longitude);}
 function dot(p,color){var el=document.createElement('div');el.className='dot';el.style.backgroundColor=color;return new kakao.maps.CustomOverlay({map:map,position:coordinate(p),content:el,yAnchor:0.5});}
 function receive(event){
  try {
   var v=JSON.parse(event.data);
   if(!map || !v || v.type!=='state' || !Number.isSafeInteger(v.revision) || !point(v.center) || !(v.myLocation===null || point(v.myLocation)) || !Array.isArray(v.markers) || v.markers.length>500) return;
   if(!v.markers.every(function(m){return point(m) && Number.isSafeInteger(m.id) && typeof m.isSupported==='boolean' && (m.color===undefined || color(m.color));})) return;
   if(!(v.lines===undefined || lines(v.lines)) || !(v.fit===undefined || fit(v.fit))) return;
   if(!lastCenter || lastCenter.latitude!==v.center.latitude || lastCenter.longitude!==v.center.longitude || lastCenter.revision!==v.revision){map.setCenter(coordinate(v.center));lastCenter={latitude:v.center.latitude,longitude:v.center.longitude,revision:v.revision};}
   polylines.forEach(function(o){o.setMap(null);});
   polylines=(v.lines||[]).map(function(l){return new kakao.maps.Polyline({map:map,path:l.points.map(coordinate),strokeWeight:6,strokeColor:l.color,strokeOpacity:0.9,strokeStyle:l.dashed?'shortdash':'solid'});});
   overlays.forEach(function(o){o.setMap(null);});
   overlays=v.markers.map(function(m){return dot(m,m.color||(m.isSupported?'#12a77a':'#8c93a3'));});
   // 범위 맞춤은 번호가 바뀔 때만 해요. 사용자가 움직인 지도는 같은 번호의 갱신으로 되돌리지 않아요.
   if(v.fit && lastFit!==v.fit.revision){var b=v.fit.bounds;map.setBounds(new kakao.maps.LatLngBounds(new kakao.maps.LatLng(b.minLat,b.minLng),new kakao.maps.LatLng(b.maxLat,b.maxLng)),40,40,40,40);lastFit=v.fit.revision;}
   if(mine)mine.setMap(null);
   mine=v.myLocation?dot(v.myLocation,'#2879ef'):null;
  }catch(e){/* 유효하지 않은 JSON과 타입은 무시 */}
 }
 window.addEventListener('message',receive);document.addEventListener('message',receive);
 function region(){var b=map.getBounds(),sw=b.getSouthWest(),ne=b.getNorthEast();send({type:'region',bounds:{minLng:sw.getLng(),minLat:sw.getLat(),maxLng:ne.getLng(),maxLat:ne.getLat()}});}
 var script=document.createElement('script');script.src=${JSON.stringify(sdkUrl)};script.onerror=fail;
 script.onload=function(){try{kakao.maps.load(function(){try{
  map=new kakao.maps.Map(document.getElementById('map'),{center:new kakao.maps.LatLng(37.5665,126.9780),level:5});
  kakao.maps.event.addListener(map,'idle',region);
  kakao.maps.event.addListener(map,'tilesloaded',function(){send({type:'ready'});});
  region();
 }catch(e){fail();}});}catch(e){fail();}};
 document.head.appendChild(script);
})();</script></body></html>`;
}
