import { isMapBounds, type MapBounds } from '@/utils/home-map';

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

/** 위치·역 데이터는 HTML에 삽입하지 않고 검증된 JSON 메시지로만 전달해요. */
export function buildMapHtml(key: string): string {
    const sdkUrl = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key).replace(/'/g, '%27')}&autoload=false`;
    return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; form-action 'none'; base-uri 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://*.kakao.com https://*.daum.net https://*.daumcdn.net; style-src 'unsafe-inline'; img-src data: https://*.kakao.com https://*.daumcdn.net https://*.daum.net; connect-src https://*.kakao.com https://*.daum.net https://*.daumcdn.net">
<style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden}.dot{width:16px;height:16px;border:3px solid white;border-radius:50%;box-shadow:0 1px 4px #555;pointer-events:none}</style></head>
<body><div id="map"></div><script>
(function(){
 var map, overlays=[], mine=null, lastCenter=null;
 window.open=function(){return null;};
 // 지도는 외부 링크를 열지 않아요(저작권 링크도 앱 밖으로 보내지 않아요).
 document.addEventListener('click',function(e){var el=e.target;while(el && el.tagName!=='A')el=el.parentElement;if(el)e.preventDefault();},true);
 function send(v){window.ReactNativeWebView.postMessage(JSON.stringify(v));}
 function fail(){send({type:'error'});}
 window.addEventListener('error',fail);
 function point(p){return p && typeof p.latitude==='number' && Number.isFinite(p.latitude) && Math.abs(p.latitude)<=90 && typeof p.longitude==='number' && Number.isFinite(p.longitude) && Math.abs(p.longitude)<=180;}
 function coordinate(p){return new kakao.maps.LatLng(p.latitude,p.longitude);}
 function dot(p,color){var el=document.createElement('div');el.className='dot';el.style.backgroundColor=color;return new kakao.maps.CustomOverlay({map:map,position:coordinate(p),content:el,yAnchor:0.5});}
 function receive(event){
  try {
   var v=JSON.parse(event.data);
   if(!map || !v || v.type!=='state' || !Number.isSafeInteger(v.revision) || !point(v.center) || !(v.myLocation===null || point(v.myLocation)) || !Array.isArray(v.markers) || v.markers.length>500) return;
   if(!v.markers.every(function(m){return point(m) && Number.isSafeInteger(m.id) && typeof m.isSupported==='boolean';})) return;
   if(!lastCenter || lastCenter.latitude!==v.center.latitude || lastCenter.longitude!==v.center.longitude || lastCenter.revision!==v.revision){map.setCenter(coordinate(v.center));lastCenter={latitude:v.center.latitude,longitude:v.center.longitude,revision:v.revision};}
   overlays.forEach(function(o){o.setMap(null);});
   overlays=v.markers.map(function(m){return dot(m,m.isSupported?'#12a77a':'#8c93a3');});
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
