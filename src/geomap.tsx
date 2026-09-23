import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {geoMercator, geoPath, geoGraticule10} from 'd3-geo';
import {feature} from 'topojson-client';
import world from 'world-atlas/countries-50m.json';

// ─────────────────────────────────────────────────────────────────────────────
// GEOMAP — MAPA VECTORIAL estilo news-explainer (recreación del vídeo de referencia
// Y6mOBK5peDU): tierra gris CLARA sobre océano navy con degradado radial, país
// enfocado con contorno grueso de color de bandera + BANDERA real encima, CAZAS
// top-down que vuelan por la ruta, EXPLOSIÓN (fireball screen-blend) al impactar,
// recorte de persona que sube de un círculo rojo, cámara continua con ease-out y grano.
// 100% código (d3-geo + world-atlas), sin plugin de $300.
// ─────────────────────────────────────────────────────────────────────────────

const TOPO: any = world as any;
const COUNTRIES: any[] = (feature(TOPO, TOPO.objects.countries) as any).features;
const byName = (n: string) =>
  COUNTRIES.find((f) => String(f.properties?.name || '').toLowerCase() === (n || '').toLowerCase());

export type GeoMarker = {lon: number; lat: number; label?: string; color?: string};
export type GeoRoute = {
  fromLon: number; fromLat: number; toLon: number; toLat: number;
  color?: string; icon?: string; strike?: boolean; jets?: number;
};
export type GeoHighlight = {name: string; color: string; flag?: string};
export type GeoMapEvent = {
  focusName?: string;
  focusLon?: number; focusLat?: number;
  highlight?: GeoHighlight[];
  markers?: GeoMarker[];
  route?: GeoRoute;
  cutout?: {lon: number; lat: number; image: string};  // recorte de persona que sube
  locName?: string;
  duration?: number;
  accent?: string;   // acento del tema/vídeo → país enfocado, pin y ruta en color coherente
};

function fitOf(features: any, W: number, H: number, pad: number) {
  const p = geoMercator();
  try {
    p.fitExtent([[pad, pad], [W - pad, H - pad]],
      {type: 'FeatureCollection', features: Array.isArray(features) ? features : [features]} as any);
  } catch {
    p.scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).center([0, 20]);
  }
  const center = p.invert ? p.invert([W / 2, H / 2]) : [0, 20];
  return {scale: p.scale(), center: (center as [number, number]) || [0, 20]};
}
const easeOut = (t: number) => interpolate(t, [0, 1], [0, 1], {
  easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
});
const _src = (s: string) => (/^(https?:|data:)/.test(s) ? s : staticFile(s));

// Caza top-down (planta tipo F-35: morro, alas delta, colas gemelas, escape) — apunta a +X.
const Jet: React.FC<{x: number; y: number; ang: number; s: number; op: number}> = ({x, y, ang, s, op}) => (
  <g transform={`translate(${x},${y}) rotate(${ang}) scale(${s})`} opacity={op}>
    <g filter="url(#jetshadow)">
      {/* fuselaje + alas delta (planform de caza) */}
      <polygon points="30,0 13,3.4 3,3.6 -13,21 -6,6.5 -18,11 -25,5.2 -25,-5.2 -18,-11 -6,-6.5 -13,-21 3,-3.6 13,-3.4"
        fill="#20242b" stroke="#0b0d10" strokeWidth={0.7} strokeLinejoin="round" />
      {/* canopy (cabina) — reflejo claro */}
      <polygon points="17,0 9,2 9,-2" fill="#5b6472" />
      {/* llamas de postquemador */}
      <polygon points="-25,2.6 -31,0 -25,-2.6" fill="#ff9a3c" opacity={0.9} />
    </g>
  </g>
);

export const GeoMap: React.FC<{event: GeoMapEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {width: W, height: H, fps, durationInFrames} = useVideoConfig();
  const dur = durationInFrames || Math.round((event.duration || 8) * fps);

  const world0 = React.useMemo(() => ({
    scale: (W / (2 * Math.PI)) * 0.98, center: [0, 25] as [number, number],
  }), [W]);

  const target = React.useMemo(() => {
    const feats: any[] = [];
    if (event.focusName) {const f = byName(event.focusName); if (f) feats.push(f);}
    (event.highlight || []).forEach((h) => {const f = byName(h.name); if (f) feats.push(f);});
    if (feats.length) return fitOf(feats, W, H, Math.min(W, H) * 0.18);
    const pts: [number, number][] = [];
    (event.markers || []).forEach((m) => pts.push([m.lon, m.lat]));
    if (event.route) {pts.push([event.route.fromLon, event.route.fromLat]); pts.push([event.route.toLon, event.route.toLat]);}
    if (event.cutout) pts.push([event.cutout.lon, event.cutout.lat]);
    if (pts.length) {
      const fc = {type: 'FeatureCollection', features: pts.map((c) => ({type: 'Feature', geometry: {type: 'Point', coordinates: c}, properties: {}}))};
      return fitOf(fc as any, W, H, Math.min(W, H) * 0.3);
    }
    return {scale: world0.scale * 3, center: [event.focusLon ?? 0, event.focusLat ?? 25] as [number, number]};
  }, [event, W, H, world0]);

  const camT = easeOut(interpolate(frame, [0, dur * 0.5], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
  const scale = Math.exp(interpolate(camT, [0, 1], [Math.log(world0.scale), Math.log(target.scale)]));
  const cx = interpolate(camT, [0, 1], [world0.center[0], target.center[0]]);
  const cy = interpolate(camT, [0, 1], [world0.center[1], target.center[1]]);
  const proj = geoMercator().scale(scale).center([cx, cy]).translate([W / 2, H / 2]);
  const path = geoPath(proj);
  const pt = (lon: number, lat: number) => proj([lon, lat]) || [W / 2, H / 2];

  // Paleta de la referencia: tierra GRIS CLARA, océano NAVY con degradado radial.
  const LAND = '#c6ccd0', LAND2 = '#bcc3c8', BORDER = 'rgba(70,92,112,0.30)';
  const accent = event.accent || '#ff5a4d';

  const highlights = event.highlight || [];
  const hlByName: Record<string, GeoHighlight> = {};
  highlights.forEach((h) => {hlByName[h.name.toLowerCase()] = h;});
  const focusLc = (event.focusName || '').toLowerCase();

  // aparición del contorno + banderas tras el zoom
  const reveal = easeOut(interpolate(frame, [dur * 0.4, dur * 0.66], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));

  return (
    <AbsoluteFill style={{backgroundColor: '#0c2440'}}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{position: 'absolute', inset: 0}}>
        <defs>
          <radialGradient id="ocean" cx="50%" cy="46%" r="75%">
            <stop offset="0%" stopColor="#1d4e7d" />
            <stop offset="60%" stopColor="#123a63" />
            <stop offset="100%" stopColor="#0a1f38" />
          </radialGradient>
          <filter id="cglow"><feGaussianBlur stdDeviation="5" /></filter>
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <filter id="jetshadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.45" />
          </filter>
          <radialGradient id="fire" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="30%" stopColor="#ffe08a" />
            <stop offset="65%" stopColor="#ff7a1e" />
            <stop offset="100%" stopColor="#8a2b06" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={W} height={H} fill="url(#ocean)" />
        {/* GRATÍCULA (rejilla lat/lon suave) sobre el océano → look de mapa documental/táctico,
            no un azul plano. Curva con la proyección mercator, así que da sensación de globo. */}
        <path d={path(geoGraticule10() as any) || ''} fill="none" stroke="#7fb0d0" strokeOpacity={0.16} strokeWidth={0.8} />
        {/* países (tierra gris clara) */}
        {COUNTRIES.map((f, i) => (
          <path key={i} d={path(f) || ''} fill={i % 2 ? LAND2 : LAND} stroke={BORDER} strokeWidth={0.6} />
        ))}
        {/* contorno grueso de color (bandera) del/los país(es) enfocado(s), se dibuja */}
        {highlights.map((h, i) => {
          const f = byName(h.name); if (!f) return null;
          return (
            <g key={`hl${i}`} opacity={reveal}>
              <path d={path(f) || ''} fill={h.color} fillOpacity={0.10} />
              <path d={path(f) || ''} fill="none" stroke={h.color} strokeWidth={4.5}
                strokeLinejoin="round" filter="url(#cglow)" opacity={0.85} />
              <path d={path(f) || ''} fill="none" stroke={h.color} strokeWidth={2.4} strokeLinejoin="round" />
            </g>
          );
        })}
        {/* país enfocado SIN color de bandera: relleno de acento SUAVE + contorno nítido en el
            acento del tema → deja de ser la "silueta blanca plana sobre azul plano" (feedback). */}
        {focusLc && !hlByName[focusLc] && (() => {
          const f = byName(event.focusName!); if (!f) return null;
          return (
            <g opacity={reveal}>
              <path d={path(f) || ''} fill={accent} fillOpacity={0.14} />
              <path d={path(f) || ''} fill="none" stroke={accent} strokeWidth={4.6} strokeLinejoin="round" filter="url(#cglow)" opacity={0.9} />
              <path d={path(f) || ''} fill="none" stroke={accent} strokeWidth={2.2} strokeLinejoin="round" />
            </g>
          );
        })()}
        {/* RUTA + CAZAS + explosión */}
        {event.route && (() => {
          const r = event.route;
          const a = pt(r.fromLon, r.fromLat), b = pt(r.toLon, r.toLat);
          const rt = interpolate(frame, [dur * 0.5, dur * 0.88], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const e = easeOut(rt);
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
          const col = r.color || accent;
          const nJets = r.jets ?? 3;
          const struck = r.strike && rt > 0.9;
          const blast = struck ? interpolate(frame, [dur * 0.9, dur * 0.97, dur], [0, 1, 0.6], {extrapolateRight: 'clamp'}) : 0;
          return (
            <g>
              {/* ruta PLANIFICADA (tenue, punteada) A→B */}
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={col} strokeWidth={1.6} strokeDasharray="4 10" opacity={0.28} />
              {/* ruta TRAZADA que se dibuja con la cámara, con glow del acento */}
              <line x1={a[0]} y1={a[1]} x2={interpolate(e, [0, 1], [a[0], b[0]])} y2={interpolate(e, [0, 1], [a[1], b[1]])}
                stroke={col} strokeWidth={3} strokeLinecap="round" opacity={0.95} style={{filter: `drop-shadow(0 0 5px ${col})`}} />
              <circle cx={a[0]} cy={a[1]} r={5} fill={col} stroke="#fff" strokeWidth={1.4} />
              {/* CABEZA = flecha genérica (documental/táctico). Los cazas F-35 SOLO en modo bélico. */}
              {!r.strike && rt > 0.02 && rt < 0.995 && (() => {
                const hx = interpolate(e, [0, 1], [a[0], b[0]]);
                const hy = interpolate(e, [0, 1], [a[1], b[1]]);
                return (
                  <g transform={`translate(${hx},${hy}) rotate(${ang})`}>
                    <polygon points="15,0 -9,8 -3,0 -9,-8" fill={col} stroke="#fff" strokeWidth={1.3} strokeLinejoin="round" />
                  </g>
                );
              })()}
              {rt > 0.9 && <circle cx={b[0]} cy={b[1]} r={6} fill="#fff" stroke={col} strokeWidth={2} />}
              {/* formación de cazas (war-room) — SOLO strike (temáticas de conflicto) */}
              {r.strike && rt > 0.02 && rt < 0.98 && Array.from({length: nJets}).map((_, k) => {
                const off = (k - (nJets - 1) / 2);
                const px = Math.cos((ang + 90) * Math.PI / 180) * off * 26;
                const py = Math.sin((ang + 90) * Math.PI / 180) * off * 26;
                const jt = Math.max(0, Math.min(1, e - Math.abs(off) * 0.04));
                return <Jet key={k} x={interpolate(jt, [0, 1], [a[0], b[0]]) + px}
                  y={interpolate(jt, [0, 1], [a[1], b[1]]) + py} ang={ang} s={1.15} op={0.95} />;
              })}
              {/* EXPLOSIÓN fireball (screen blend: los negros desaparecen) */}
              {r.strike && blast > 0 && (
                <g style={{mixBlendMode: 'screen'}}>
                  {/* bola de fuego con gradiente real */}
                  <circle cx={b[0]} cy={b[1]} r={16 + 66 * blast} fill="url(#fire)" opacity={1 - blast * 0.35} />
                  <circle cx={b[0]} cy={b[1]} r={7 + 14 * blast} fill="#fff" opacity={1 - blast * 0.4} />
                  {/* onda de choque expandiéndose */}
                  <circle cx={b[0]} cy={b[1]} r={24 + 95 * blast} fill="none" stroke="#ffcf8a"
                    strokeWidth={3.5 * (1 - blast)} opacity={0.9 * (1 - blast)} />
                  {/* chispas/debris radiales */}
                  {[0, 45, 90, 135, 180, 225, 270, 315].map((a, k) => {
                    const rr = (18 + 70 * blast);
                    const dx = Math.cos(a * Math.PI / 180) * rr, dy = Math.sin(a * Math.PI / 180) * rr;
                    return <circle key={k} cx={b[0] + dx} cy={b[1] + dy} r={2.4 * (1 - blast)}
                      fill="#ffd27a" opacity={1 - blast} />;
                  })}
                </g>
              )}
            </g>
          );
        })()}
        {/* marcadores: círculo rojo que "pop" + etiqueta */}
        {(event.markers || []).map((m, i) => {
          const [x, y] = pt(m.lon, m.lat);
          const t0 = dur * (0.58 + i * 0.06);
          const pop = easeOut(interpolate(frame, [t0, t0 + fps * 0.5], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
          const col = m.color || accent;
          return (
            <g key={`mk${i}`} opacity={pop}>
              <circle cx={x} cy={y} r={8 * pop} fill={col} />
              <circle cx={x} cy={y} r={8 * pop} fill="none" stroke="#fff" strokeWidth={1.6} />
              {m.label && (
                <text x={x + 13} y={y + 6} fill="#fff" fontSize={24} fontFamily="Inter, Arial, sans-serif"
                  fontWeight={800} style={{paintOrder: 'stroke', stroke: '#0a1f38', strokeWidth: 5, strokeOpacity: 0.7}}>
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
        {/* PIN + anillo del país enfocado cuando NO hay marcadores explícitos → ancla la
            ubicación (con la etiqueta locName de abajo) en vez de dejar el país "flotando". */}
        {event.focusName && !(event.markers && event.markers.length) && (() => {
          const f = byName(event.focusName!); if (!f) return null;
          const c = path.centroid(f); if (!c || isNaN(c[0])) return null;
          const pop = easeOut(interpolate(frame, [dur * 0.5, dur * 0.5 + fps * 0.5], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
          return (
            <g opacity={pop}>
              <circle cx={c[0]} cy={c[1]} r={22 * (1 - pop)} fill="none" stroke={accent} strokeWidth={2} opacity={1 - pop} />
              <circle cx={c[0]} cy={c[1]} r={8 * pop} fill={accent} />
              <circle cx={c[0]} cy={c[1]} r={8 * pop} fill="none" stroke="#fff" strokeWidth={1.8} />
            </g>
          );
        })()}
        <rect x={0} y={0} width={W} height={H} filter="url(#grain)" opacity={0.05} style={{mixBlendMode: 'overlay'}} />
      </svg>
      {/* BANDERAS reales sobre los países (spring) — HTML para nitidez del PNG */}
      {highlights.filter((h) => h.flag).map((h, i) => {
        const f = byName(h.name); if (!f) return null;
        const c = path.centroid(f); if (!c || isNaN(c[0])) return null;
        const t0 = dur * 0.5 + i * 4;
        const sp = easeOut(interpolate(frame, [t0, t0 + fps * 0.55], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
        const fw = 96;
        return (
          <div key={`fl${i}`} style={{
            position: 'absolute', left: c[0] - fw / 2, top: c[1] - fw * 0.34,
            width: fw, transform: `scale(${sp})`, transformOrigin: 'center bottom',
            opacity: sp, boxShadow: '0 3px 12px rgba(0,0,0,0.5)', border: '2px solid #fff', borderRadius: 3, overflow: 'hidden',
          }}>
            <Img src={_src(h.flag!)} style={{width: '100%', display: 'block'}} />
          </div>
        );
      })}
      {/* recorte de persona que SUBE de un círculo rojo (escena tipo intro) */}
      {event.cutout && (() => {
        const [x, y] = pt(event.cutout.lon, event.cutout.lat);
        const t0 = dur * 0.5;
        const rise = easeOut(interpolate(frame, [t0, t0 + fps * 0.7], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
        return (
          <>
            <div style={{position: 'absolute', left: x - 70, top: y - 70, width: 140, height: 140,
              borderRadius: '50%', background: '#e8241f', opacity: rise * 0.95}} />
            <div style={{position: 'absolute', left: x - 60, top: y - 150 * rise, width: 120,
              opacity: rise, filter: 'grayscale(1) contrast(1.05)'}}>
              <Img src={_src(event.cutout.image)} style={{width: '100%', display: 'block'}} />
            </div>
          </>
        );
      })()}
      {event.locName && (
        <div style={{position: 'absolute', left: 0, right: 0, bottom: H * 0.07, textAlign: 'center'}}>
          <span style={{color: '#fff', fontFamily: 'Inter, Arial, sans-serif', fontWeight: 800, fontSize: 40,
            letterSpacing: 1, textTransform: 'uppercase', textShadow: '0 2px 18px rgba(0,0,0,0.85)',
            opacity: easeOut(interpolate(frame, [dur * 0.48, dur * 0.66], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}))}}>
            {event.locName}
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};
