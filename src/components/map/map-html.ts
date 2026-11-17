import { isCoordinate, isMapBounds, isMapLevel, STATION_HIDE_LEVEL, type MapBounds } from '@/utils/home-map';
import { trainModelSvg, passengerModelSvg, MAP_MODEL_STYLE, MAP_MODEL_LABEL_STYLE } from '@/components/map/map-models';

/** 지도로 보내는 메시지 상한. 앱(route-map)이 이 안으로 줄여 보내고, 넘는 메시지는 지도가 통째로 무시해요. */
export const MAP_LIMITS = { markers: 500, lines: 50, linePoints: 1000, totalPoints: 5000 } as const;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export function isHexColor(value: unknown): value is string {
    return typeof value === 'string' && HEX_COLOR.test(value);
}
export function isValidMapSelection(value: { stationSelection?: unknown; selectedStationId?: unknown; selectedStationName?: unknown; selectedStationColor?: unknown }) {
    return (value.stationSelection === undefined || typeof value.stationSelection === 'boolean')
        && (value.selectedStationId === undefined || value.selectedStationId === null || (Number.isSafeInteger(value.selectedStationId) && (value.selectedStationId as number) > 0))
        && (value.selectedStationName === undefined || typeof value.selectedStationName === 'string')
        && (value.selectedStationColor === undefined || isHexColor(value.selectedStationColor));
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

export type MapMessage = { type: 'ready' } | { type: 'error' } | { type: 'region'; bounds: MapBounds; level: number } | { type: 'stationPress'; id: number } | { type: 'mapPress' };
export function parseMapMessage(raw: string): MapMessage | null {
    try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object') return null;
        const v = value as Record<string, unknown>;
        if (v.type === 'ready' || v.type === 'error') return { type: v.type };
        if (v.type === 'stationPress' && Number.isSafeInteger(v.id) && (v.id as number) > 0) return { type: 'stationPress', id: v.id as number };
        if (v.type === 'mapPress') return { type: 'mapPress' };
        if (v.type === 'region' && isMapBounds(v.bounds) && isMapLevel(v.level)) return { type: 'region', bounds: v.bounds, level: v.level };
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; form-action 'none'; base-uri 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://*.kakao.com https://*.daum.net https://*.daumcdn.net https://*.kakaocdn.net; style-src 'unsafe-inline'; img-src data: https://*.kakao.com https://*.daumcdn.net https://*.kakaocdn.net https://*.daum.net; connect-src https://*.kakao.com https://*.daum.net https://*.daumcdn.net https://*.kakaocdn.net">
<style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden}.dot{box-sizing:border-box;width:14px;height:14px;background:white;border:3px solid #5C3F78;border-radius:50%;box-shadow:0 1px 4px #555;pointer-events:none}.dot-filled{box-sizing:content-box;width:16px;height:16px;border:3px solid white}.station-hit{width:44px;height:44px;display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;background:transparent;border:0;padding:0}</style></head>
<body><div id="map"></div><script>
(function(){
 var map, overlays=[], polylines=[], mine=null, selected=null, state=null, lastCenter=null, lastFit=null;
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
 function stop(e){e.stopPropagation();kakao.maps.event.preventMap();}
 function dot(p,color,filled,interactive){
  var el=document.createElement('div');el.className=filled?'dot dot-filled':'dot';if(filled)el.style.backgroundColor=color;else el.style.borderColor=color;
  if(interactive && p.id>0){var hit=document.createElement('div');hit.className='station-hit';hit.setAttribute('role','button');hit.setAttribute('aria-label','역 선택');hit.tabIndex=0;hit.appendChild(el);hit.onmousedown=hit.ontouchstart=stop;hit.onclick=function(e){stop(e);send({type:'stationPress',id:p.id});};hit.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();hit.onclick(e);}};el=hit;}
  return new kakao.maps.CustomOverlay({map:map,position:coordinate(p),content:el,yAnchor:0.5});
 }
 function model(p,train,label,c){
  var el=document.createElement('div');el.className='map-model';el.style.cssText=${JSON.stringify(MAP_MODEL_STYLE)};
  var name=document.createElement('div');name.style.cssText=${JSON.stringify(MAP_MODEL_LABEL_STYLE)};name.textContent=label;
  var image=document.createElement('img');image.width=train?48:40;image.height=train?40:44;image.alt='';image.draggable=false;image.style.cssText='display:block;pointer-events:none';
  var svg=train?${JSON.stringify(trainModelSvg('#F0F0F0'))}.replace(/#F0F0F0/g,c):${JSON.stringify(passengerModelSvg())};image.src='data:image/svg+xml;utf8,'+encodeURIComponent(svg);
  el.appendChild(name);el.appendChild(image);return new kakao.maps.CustomOverlay({map:map,position:coordinate(p),content:el,yAnchor:1,zIndex:train?3:2});
 }
 function selectedModel(){
  if(selected)selected.setMap(null);selected=null;
  if(!state || !state.stationSelection || map.getLevel()>=${STATION_HIDE_LEVEL})return;
  var marker=state.markers.find(function(m){return m.id===state.selectedStationId;});
  if(marker)selected=model(marker,true,state.selectedStationName||'선택한 역',state.selectedStationColor||'#5C3F78');
 }
 function receive(event){
  try {
   var v=JSON.parse(event.data);
   if(!map || !v || v.type!=='state' || !Number.isSafeInteger(v.revision) || !point(v.center) || !(v.myLocation===null || point(v.myLocation)) || !Array.isArray(v.markers) || v.markers.length>500) return;
   if(!v.markers.every(function(m){return point(m) && Number.isSafeInteger(m.id) && typeof m.isSupported==='boolean' && (m.color===undefined || color(m.color));})) return;
   if(!(v.lines===undefined || lines(v.lines)) || !(v.fit===undefined || fit(v.fit))) return;
   if(!(v.stationSelection===undefined || typeof v.stationSelection==='boolean') || !(v.selectedStationId===undefined || v.selectedStationId===null || (Number.isSafeInteger(v.selectedStationId)&&v.selectedStationId>0)) || !(v.selectedStationName===undefined || typeof v.selectedStationName==='string') || !(v.selectedStationColor===undefined || color(v.selectedStationColor))) return;
   state=v;
   if(!lastCenter || lastCenter.latitude!==v.center.latitude || lastCenter.longitude!==v.center.longitude || lastCenter.revision!==v.revision){map.setCenter(coordinate(v.center));lastCenter={latitude:v.center.latitude,longitude:v.center.longitude,revision:v.revision};}
   polylines.forEach(function(o){o.setMap(null);});
   polylines=(v.lines||[]).map(function(l){return new kakao.maps.Polyline({map:map,path:l.points.map(coordinate),strokeWeight:6,strokeColor:l.color,strokeOpacity:0.9,strokeStyle:l.dashed?'shortdash':'solid'});});
   overlays.forEach(function(o){o.setMap(null);});
   overlays=v.markers.map(function(m){return dot(m,m.color||(m.isSupported?'#5C3F78':'#B9B5C0'),!!m.color,v.stationSelection===true);});
   // 범위 맞춤은 번호가 바뀔 때만 해요. 사용자가 움직인 지도는 같은 번호의 갱신으로 되돌리지 않아요.
   if(v.fit && lastFit!==v.fit.revision){var b=v.fit.bounds;map.setBounds(new kakao.maps.LatLngBounds(new kakao.maps.LatLng(b.minLat,b.minLng),new kakao.maps.LatLng(b.maxLat,b.maxLng)),40,40,40,40);lastFit=v.fit.revision;}
   if(mine)mine.setMap(null);
   mine=v.myLocation?(v.stationSelection?model(v.myLocation,false,'나','#5C3F78'):dot(v.myLocation,'#2879ef',true)):null;
   selectedModel();
  }catch(e){/* 유효하지 않은 JSON과 타입은 무시 */}
 }
 window.addEventListener('message',receive);document.addEventListener('message',receive);
 function region(){selectedModel();var b=map.getBounds(),sw=b.getSouthWest(),ne=b.getNorthEast();send({type:'region',bounds:{minLng:sw.getLng(),minLat:sw.getLat(),maxLng:ne.getLng(),maxLat:ne.getLat()},level:map.getLevel()});}
 var script=document.createElement('script');script.src=${JSON.stringify(sdkUrl)};script.onerror=fail;
 script.onload=function(){try{kakao.maps.load(function(){try{
  map=new kakao.maps.Map(document.getElementById('map'),{center:new kakao.maps.LatLng(37.5665,126.9780),level:5});
  kakao.maps.event.addListener(map,'idle',region);
  kakao.maps.event.addListener(map,'click',function(){if(state && state.stationSelection)send({type:'mapPress'});});
  kakao.maps.event.addListener(map,'tilesloaded',function(){send({type:'ready'});});
  region();
 }catch(e){fail();}});}catch(e){fail();}};
 document.head.appendChild(script);
})();</script></body></html>`;
}
