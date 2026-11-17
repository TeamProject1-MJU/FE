/** Map SVGs match TrainBlock(size 48) and Passenger(tone me, size 40). */
export function trainModelSvg(color: string) {
    const size = 48, height = 40;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 40" width="${size}" height="${height}">
<ellipse cx="23" cy="35.5" rx="19" ry="4" fill="#2A1F3A" opacity="0.08"/>
<polygon points="5.6,10 31.6,25 31.6,37 5.6,22" fill="#FFFFFF"/>
<polygon points="5.6,20 31.6,35 31.6,37 5.6,22" fill="#D9D4E1"/>
<polygon points="31.6,25 42,19 42,31 31.6,37" fill="#EAE6F0"/>
<polygon points="31.6,35 42,29 42,31 31.6,37" fill="#CBC5D5"/>
<polygon points="16,4 42,19 31.6,25 5.6,10" fill="${color}"/>
<polygon points="17.6,6.6 37.4,18 31.5,21.4 11.7,10" fill="#FFFFFF" opacity="0.26"/>
<polygon points="5.6,10 31.6,25 31.6,27 5.6,12" fill="${color}" opacity="0.6"/>
<polygon points="8.2,14.5 13.4,17.5 13.4,21.3 8.2,18.3" fill="#CDD5EC"/>
<polygon points="16,19 21.2,22 21.2,25.8 16,22.8" fill="#CDD5EC"/>
<polygon points="23.8,23.5 29,26.5 29,30.3 23.8,27.3" fill="#CDD5EC"/>
<polygon points="34.2,26.5 39.4,23.5 39.4,27.3 34.2,30.3" fill="#C3CBE4"/>
<polyline points="5.6,10 31.6,25 42,19" fill="none" stroke="#FFFFFF" stroke-width="0.6" opacity="0.7"/>
</svg>`;
}
export function passengerModelSvg() {
    const size = 40, shadow = true, eyes = true;
    const [t, l, r, leg, legD] = ['#BCA6D2', '#8466A6', '#5C3F78', '#4A3263', '#382549'];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 44" width="${size}" height="${size * 1.1}">
${shadow ? '<ellipse cx="20" cy="41.5" rx="12" ry="3" fill="#2A1F3A" opacity="0.10"/>' : ''}
<polygon points="10,31 20,36 20,42 10,37" fill="${leg}"/>
<polygon points="20,36 30,31 30,37 20,42" fill="${legD}"/>
<polygon points="10,25 20,30 20,36 10,31" fill="${l}"/>
<polygon points="20,30 30,25 30,31 20,36" fill="${r}"/>
<polygon points="20,2 34,9 20,16 6,9" fill="${t}"/>
<polygon points="6,9 20,16 20,30 6,23" fill="${l}"/>
<polygon points="20,16 34,9 34,23 20,30" fill="${r}"/>
<polyline points="6,9 20,16 34,9" fill="none" stroke="#FFFFFF" stroke-width="0.7" opacity="0.45"/>
${eyes ? '<polygon points="10,16.5 12.2,17.6 12.2,20.8 10,19.7" fill="#1F1828"/><polygon points="15.2,19.1 17.4,20.2 17.4,23.4 15.2,22.3" fill="#1F1828"/>' : ''}
</svg>`;
}
export const MAP_MODEL_STYLE = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;white-space:nowrap';
export const MAP_MODEL_LABEL_STYLE = 'font:600 12px sans-serif;color:#25212D;background:white;border:1px solid #EEEAF2;border-radius:10px;padding:3px 8px;margin-bottom:3px';
export function mapModelElement(doc: Document, train: boolean, label: string, color: string) {
    const el = doc.createElement('div'); el.className = 'map-model'; el.style.cssText = MAP_MODEL_STYLE;
    const name = doc.createElement('div'); name.style.cssText = MAP_MODEL_LABEL_STYLE; name.textContent = label;
    const image = doc.createElement('img'); image.width = train ? 48 : 40; image.height = train ? 40 : 44;
    image.alt = ''; image.draggable = false; image.style.cssText = 'display:block;pointer-events:none';
    image.src = `data:image/svg+xml;utf8,${encodeURIComponent(train ? trainModelSvg(color) : passengerModelSvg())}`;
    el.appendChild(name); el.appendChild(image); return el;
}
