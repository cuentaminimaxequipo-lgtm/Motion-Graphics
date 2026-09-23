import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing} from 'remotion';

/**
 * Overlays editoriales DOCUMENTALES (2026-09-05) — calcados de las referencias reales que el
 * usuario señaló (Eli Yoder, American Secrets, Firearms Vault, Make Tech Future, Griffith Elijah,
 * Yesterday's Brands). Cada plantilla es UNA función comunicativa; el canal decide cuáles activa
 * (motionTemplates) y MiniMax elige entre las permitidas. Sin HUDs, sin partículas.
 *
 *  big_stat_doc    "$40 / AMISH FOOD COOLING BOX…"       cifra enorme blanca centrada + caption
 *  echo_title      "The Most Honest Document"            título serif con eco (opcional por canal)
 *  caption_bar     "HEAT PIPE THEORY AND PRACTICE"       barra de acento abajo (capítulos) ★ preferida
 *  paper_tag       "2001 EB-1 GREEN CARD"                etiqueta de papel abajo-izquierda
 *  callout_label   "WOODEN LID"                          cajita + línea al objeto (targetX/Y)
 *  tag_label       "LOCKED BREECH"                       cajita sin flecha, esquina
 *  label_pair      "SEASONAL EXTREMES | STEADY EARTH COOL"
 *  date_stamp      "July 2016"                           fecha serif esquina superior derecha
 *  quote_card      "One of Five Slovenians / …"          barra + titular + cuerpo + fuente
 *  quote_line      "When I was teaching myself…"         cita a máquina abajo
 *  title_kicker    "From Florida To Kentucky / The Call" kicker cursiva + título bold abajo-izq
 *  stamp_word      "GLOBAL" / "SCRUBBED"                 palabra gigante sobre panel de acento
 *  kinetic_words   "the filing called her / one of…"     palabras dispersas a distintos tamaños
 *  parts_diagram   piezas del fusil                      foto en tarjeta + varias etiquetas con línea
 *  topic_list      "PRODUCTION PRIORITIES"               cabecera + puntos que van apareciendo
 *  photo_inset     "Sturmgewehr 44: Assault Rifle"       foto enmarcada pequeña sobre metraje + pie
 *  photo_caption   "SEASONAL SWINGS FADE"                polaroid centrada sobre negro + pie
 *  year_timeline   1890 · 1920 · 1960                    línea con 3-5 hitos fechados
 *  year_dot        "2026"                                un año sobre una línea fina
 *  circle_compare  dos fotos en círculo sobre acento
 *  subject_profile HAROLD & HELEN KITE + características  foto a un lado, nombre y lista al otro
 *  rank_badge      "#14"                                 badge de ranking abajo-izquierda
 *  doc_highlight   documento con frase subrayada         foto de documento + banda de resaltador
 */
export const DOCUMENTARY_TYPES = [
  'big_stat_doc', 'echo_title', 'caption_bar', 'paper_tag', 'callout_label', 'tag_label', 'label_pair',
  'date_stamp', 'quote_card', 'quote_line', 'title_kicker', 'stamp_word', 'kinetic_words',
  'parts_diagram', 'topic_list', 'photo_inset', 'photo_caption', 'year_timeline', 'year_dot',
  'circle_compare', 'subject_profile', 'rank_badge', 'doc_highlight',
  // ronda 3 (más referencias): texto rojo deslizante, tira de fotos numeradas, etiqueta
  // central pequeña, número con glitch, recuadro blanco sobre una zona del plano.
  'ticker_word', 'photo_strip', 'center_label', 'glitch_number', 'frame_box',
] as const;
export type DocumentaryType = (typeof DOCUMENTARY_TYPES)[number];
export const isDocumentaryType = (type?: string): type is DocumentaryType =>
  (DOCUMENTARY_TYPES as readonly string[]).includes(String(type || ''));

export type DocEvent = {
  id?: string;
  type?: string;
  title?: string;
  subtitle?: string;
  kicker?: string;
  items?: string[];
  accent?: string;
  duration?: number;
  targetX?: number;
  targetY?: number;
  side?: string;
  rank?: number;
  image?: string;
  image2?: string;
  lang?: string;
  revealSeconds?: number;
  /** frame_box: caja normalizada [x1, y1, x2, y2] situada por visión. */
  box?: number[];
  targets?: number[][];
};

const F = {
  serif: "'PlayfairDisplay', Georgia, 'Times New Roman', serif",
  cond: "'BarlowCondensed', 'Oswald', 'Arial Narrow', sans-serif",
  num: "'BebasNeue', 'Oswald', 'Arial Narrow', sans-serif",
  black: "'ArchivoBlack', 'Arial Black', Impact, sans-serif",
  sans: "'Oswald', 'Arial Narrow', sans-serif",
  mono: "'Courier New', Courier, monospace",
};
const INK = '#151311';
const PAPER = '#efe7d6';
const WHITE_BOX = '#f6f3ec';
const PAD = 72;

const clean = (v?: string) => String(v || '').replace(/\s+/g, ' ').trim();
const clamp01 = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(0.98, Math.max(0.02, n)) : d;
};
const media = (value: string) => /^(https?:|data:)/i.test(value) ? value : staticFile(value);
const items = (e: DocEvent, max = 5) => (e.items || []).map((s) => clean(s)).filter(Boolean).slice(0, max);

/** PANTALLA COMPLETA: la foto de la escena a sangre, desenfocada y oscurecida, detrás de las
 * composiciones con tarjetas (el usuario: "debe ser pantalla completa, si no se ve raro"). */
const Backdrop: React.FC<{src?: string; dim?: number; blur?: number}> = ({src, dim = 0.58, blur = 22}) => (
  src ? (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Img src={media(src)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.12)', filter: `blur(${blur}px) brightness(${1 - dim}) saturate(0.7)`}} />
    </AbsoluteFill>
  ) : null
);

/** Vida del overlay: fade-in corto, meseta, fade-out; y un spring de entrada para deslizar. */
const useLife = (duration?: number) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const end = Math.max(12, Math.min(durationInFrames, Math.round((duration || durationInFrames / fps) * fps)));
  const inF = Math.min(14, Math.max(6, Math.round(fps * 0.42)));
  const outF = Math.min(12, Math.max(5, Math.round(fps * 0.34)));
  const opacity = interpolate(frame, [0, inF, Math.max(inF + 1, end - outF), end], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const enter = spring({frame, fps, config: {damping: 20, stiffness: 150, mass: 0.8}, durationInFrames: inF + 8});
  const y = interpolate(enter, [0, 1], [26, 0]);
  const wipe = interpolate(frame, [2, 2 + Math.round(fps * 0.5)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const stagger = (k: number, step = 7, len = 10) => interpolate(frame, [6 + k * step, 6 + k * step + len], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  return {frame, fps, end, opacity, enter, y, wipe, stagger};
};

// ── 1) CIFRA ENORME CENTRADA ("$40") ────────────────────────────────────────────
const parseBig = (title: string, subtitle: string) => {
  const m = title.match(/([$€£]\s?)?(\d[\d.,]*)(\s?(%|°\s?[CF]?|km|kg|mm|cm|m|h|min|s|lb|ft|MW|kW|x))?/i);
  if (!m) return {raw: title, digits: '', prefix: '', suffix: '', caption: subtitle || '', countable: false};
  const raw = m[0].trim();
  const digits = m[2];
  const prefix = (m[1] || '').trim();
  const suffix = (m[3] || '').trim();
  const rest = clean(title.replace(m[0], ' '));
  const caption = subtitle || rest;
  const countable = /^\d{1,7}$/.test(digits);
  return {raw, digits, prefix, suffix, caption, countable};
};

const BigStatDoc: React.FC<{event: DocEvent}> = ({event}) => {
  const {frame, fps, opacity, enter} = useLife(event.duration);
  const title = clean(event.title);
  const sub = clean(event.subtitle);
  const big = parseBig(title, sub);
  const p = interpolate(frame, [0, Math.round(fps * 0.7)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const loc = String(event.lang || 'es').startsWith('en') ? 'en-US' : 'es-ES';
  const shown = big.countable
    ? `${big.prefix}${Math.round(Number(big.digits) * p).toLocaleString(loc)}${big.suffix ? ' ' + big.suffix : ''}`
    : big.raw;
  const caption = clean(big.caption).slice(0, 70);
  return (
    <AbsoluteFill style={{opacity}}>
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.22) 55%, rgba(0,0,0,0.05) 100%)'}} />
      <div style={{position: 'absolute', left: 0, right: 0, top: '50%', transform: `translateY(-50%) scale(${0.92 + enter * 0.08})`, textAlign: 'center', padding: '0 80px'}}>
        <div style={{fontFamily: F.num, fontSize: 270, lineHeight: 0.9, color: '#ffffff', letterSpacing: 1, textShadow: '0 5px 0 rgba(0,0,0,0.28), 0 22px 60px rgba(0,0,0,0.8)'}}>
          {shown}
        </div>
        {caption ? (
          <div style={{fontFamily: F.cond, fontSize: 36, fontWeight: 700, color: '#ffffff', textTransform: 'uppercase', letterSpacing: 2.4, marginTop: 10, textShadow: '0 4px 18px rgba(0,0,0,0.9)'}}>
            {caption}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 2) TÍTULO CON ECO ("The Most Honest Document") ─────────────────────────────
const EchoTitle: React.FC<{event: DocEvent}> = ({event}) => {
  const {frame, fps, opacity, y, wipe} = useLife(event.duration);
  const accent = event.accent || '#c9a86a';
  const title = clean(event.title).slice(0, 60);
  const kicker = clean(event.kicker).slice(0, 30);
  const echo = `${title}   ${title}   ${title}`;
  const drift = interpolate(frame, [0, fps * 6], [0, -90], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{opacity, overflow: 'hidden'}}>
      <AbsoluteFill style={{background: 'rgba(5,5,7,0.58)'}} />
      <div style={{position: 'absolute', left: -160, right: -160, top: '50%', transform: `translateY(-50%) translateX(${drift}px)`, opacity: 0.10, pointerEvents: 'none'}}>
        {[0, 1, 2].map((r) => (
          <div key={r} style={{whiteSpace: 'nowrap', fontFamily: F.serif, fontSize: 158, lineHeight: 1.0, color: '#ffffff', fontWeight: 700, marginLeft: r % 2 ? -260 : 0}}>
            {echo}
          </div>
        ))}
      </div>
      <div style={{position: 'absolute', left: PAD, right: PAD, top: '50%', transform: `translateY(-50%) translateY(${y}px)`, textAlign: 'center'}}>
        {kicker ? <div style={{fontFamily: F.cond, color: accent, fontSize: 22, fontWeight: 700, letterSpacing: 3.2, textTransform: 'uppercase', marginBottom: 16}}>{kicker}</div> : null}
        <div style={{fontFamily: F.serif, fontSize: 84, lineHeight: 1.02, color: '#ffffff', fontWeight: 700, textShadow: '0 6px 30px rgba(0,0,0,0.9)', maxWidth: 1240, margin: '0 auto'}}>
          {title}
        </div>
        <div style={{width: 150 * wipe, height: 4, background: accent, margin: '22px auto 0'}} />
      </div>
    </AbsoluteFill>
  );
};

// ── 3) BARRA DE CAPÍTULO ABAJO ("HEAT PIPE THEORY AND PRACTICE") ──────────────
const CaptionBar: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, enter} = useLife(event.duration);
  const accent = event.accent || '#f2c230';
  const title = clean(event.title).slice(0, 56);
  const kicker = clean(event.kicker || event.subtitle).slice(0, 40);
  if (!title) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: '9%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, transform: `translateY(${(1 - enter) * 30}px)`}}>
        {kicker ? <div style={{fontFamily: F.cond, fontSize: 26, fontWeight: 700, color: '#ffffff', letterSpacing: 3, textTransform: 'uppercase', textShadow: '0 3px 14px rgba(0,0,0,0.9)'}}>{kicker}</div> : null}
        {/* Referencia "HEAT PIPE THEORY AND PRACTICE": barra ancha y alta, se lee desde lejos. */}
        <div style={{background: accent, color: INK, fontFamily: F.cond, fontWeight: 700, fontSize: 56, textTransform: 'uppercase', letterSpacing: 2, padding: '16px 44px 18px', lineHeight: 1.05, minWidth: 620, textAlign: 'center', boxShadow: '0 12px 34px rgba(0,0,0,0.6)', transform: `scaleX(${0.85 + enter * 0.15})`}}>
          {title}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 4) ETIQUETA DE PAPEL ("2001 EB-1 GREEN CARD") ──────────────────────────────
const PaperTag: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, y} = useLife(event.duration);
  const accent = event.accent || '#c9a86a';
  const title = clean(event.title).slice(0, 46);
  const sub = clean(event.subtitle).slice(0, 64);
  const kicker = clean(event.kicker).slice(0, 26);
  if (!title) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', left: PAD, bottom: PAD, transform: `translateY(${y}px) rotate(-1.2deg)`, transformOrigin: 'left bottom'}}>
        <div style={{background: PAPER, color: INK, padding: '13px 24px 14px 20px', display: 'inline-block', borderLeft: `8px solid ${accent}`, boxShadow: '0 14px 32px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.07)', maxWidth: 760}}>
          {kicker ? <div style={{fontFamily: F.mono, fontSize: 14, letterSpacing: 2.2, textTransform: 'uppercase', color: '#6b5f4a', marginBottom: 5}}>{kicker}</div> : null}
          <div style={{fontFamily: F.cond, fontSize: 36, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.9, lineHeight: 1.05}}>{title}</div>
          {sub ? <div style={{fontFamily: F.mono, fontSize: 17, color: '#3b352c', marginTop: 7, letterSpacing: 0.5}}>{sub}</div> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 5) CALLOUT CON FLECHA ("WOODEN LID") ───────────────────────────────────────
const CalloutLabel: React.FC<{event: DocEvent}> = ({event}) => {
  const {frame, fps, opacity} = useLife(event.duration);
  const {width: W, height: H} = useVideoConfig();
  const title = clean(event.title).slice(0, 34);
  const tx = clamp01(event.targetX, 0.5);
  const ty = clamp01(event.targetY, 0.45);
  const px = tx * W;
  const py = ty * H;
  const toRight = tx < 0.5;
  const gapX = 150;
  const boxX = toRight ? px + gapX : px - gapX;
  const boxY = Math.min(H - 150, Math.max(90, py - 120));
  const draw = interpolate(frame, [4, 4 + Math.round(fps * 0.45)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const boxIn = interpolate(draw, [0.55, 1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const endX = px + (boxX - px) * draw;
  const endY = py + (boxY + 24 - py) * draw;
  if (!title) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <svg width={W} height={H} style={{position: 'absolute', inset: 0}}>
        <circle cx={px} cy={py} r={20} fill="none" stroke="#ffffff" strokeWidth={2} opacity={draw * 0.9} />
        <circle cx={px} cy={py} r={7} fill="#ffffff" opacity={draw} />
        <line x1={px} y1={py} x2={endX} y2={endY} stroke="#ffffff" strokeWidth={2.5} strokeLinecap="round" />
      </svg>
      <div style={{position: 'absolute', top: boxY, ...(toRight ? {left: boxX} : {right: W - boxX}), background: WHITE_BOX, color: INK, fontFamily: F.cond, fontSize: 25, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, padding: '9px 17px', whiteSpace: 'nowrap', boxShadow: '0 10px 24px rgba(0,0,0,0.5)', opacity: boxIn, transform: `translateY(${(1 - boxIn) * 8}px)`}}>
        {title}
      </div>
    </AbsoluteFill>
  );
};

// ── 6) ETIQUETA SIN FLECHA ("LOCKED BREECH") ───────────────────────────────────
const TagLabel: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, enter} = useLife(event.duration);
  const title = clean(event.title).slice(0, 34);
  const right = (event.side || 'right') !== 'left';
  if (!title) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', top: PAD - 6, ...(right ? {right: PAD} : {left: PAD}), background: WHITE_BOX, color: INK, fontFamily: F.cond, fontSize: 26, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.6, padding: '10px 18px', boxShadow: '0 10px 24px rgba(0,0,0,0.5)', transform: `translateY(${(1 - enter) * -14}px)`}}>
        {title}
      </div>
    </AbsoluteFill>
  );
};

// ── 7) PAR DE ETIQUETAS ("SEASONAL EXTREMES | STEADY EARTH COOL") ──────────────
const LabelPair: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, enter} = useLife(event.duration);
  const its = items(event, 2);
  let a = its[0] || '';
  let b = its[1] || '';
  if (!a || !b) {
    const parts = clean(event.title).split(/\s*(?:\||\/|—|–| vs\.? | contra | frente a )\s*/i).map((s) => s.trim()).filter(Boolean);
    a = a || parts[0] || '';
    b = b || parts[1] || clean(event.subtitle);
  }
  if (!a || !b) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', left: 0, right: 0, top: '40%', display: 'flex', justifyContent: 'center', gap: 130, padding: '0 120px'}}>
        {[a, b].map((t, k) => (
          <div key={k} style={{transform: `translateX(${(k ? 1 : -1) * (1 - enter) * 90}px)`, background: WHITE_BOX, color: INK, fontFamily: F.cond, fontWeight: 700, fontSize: 40, textTransform: 'uppercase', letterSpacing: 1.8, padding: '26px 40px', textAlign: 'center', lineHeight: 1.1, boxShadow: '0 12px 30px rgba(0,0,0,0.55)', minWidth: 340, maxWidth: 520}}>
            {t.slice(0, 40)}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ── 8) SELLO DE FECHA ("July 2016") ────────────────────────────────────────────
const DateStamp: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, y, wipe} = useLife(event.duration);
  const accent = event.accent || '#c9a86a';
  const title = clean(event.title).slice(0, 26);
  const sub = clean(event.subtitle).slice(0, 44);
  const kicker = clean(event.kicker).slice(0, 26);
  if (!title) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', right: PAD, top: PAD - 8, textAlign: 'right', transform: `translateY(${-y}px)`}}>
        {kicker ? <div style={{fontFamily: F.cond, fontSize: 18, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: accent, marginBottom: 4}}>{kicker}</div> : null}
        <div style={{fontFamily: F.serif, fontSize: 66, fontWeight: 700, color: '#ffffff', lineHeight: 1, textShadow: '0 6px 26px rgba(0,0,0,0.9)'}}>{title}</div>
        {sub ? <div style={{fontFamily: F.cond, fontSize: 23, fontWeight: 700, color: 'rgba(255,255,255,0.88)', letterSpacing: 1.2, marginTop: 8, textShadow: '0 3px 14px rgba(0,0,0,0.9)'}}>{sub}</div> : null}
        <div style={{height: 3, width: 130 * wipe, background: accent, marginLeft: 'auto', marginTop: 10}} />
      </div>
    </AbsoluteFill>
  );
};

// ── 9) TARJETA DE CITA ("One of Five Slovenians") ──────────────────────────────
const QuoteCard: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, y, wipe} = useLife(event.duration);
  const accent = event.accent || '#c9a86a';
  const title = clean(event.title).slice(0, 60);
  const body = clean(event.subtitle).slice(0, 170);
  const source = clean(event.kicker).slice(0, 60);
  if (!title && !body) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(4,4,6,0.88) 0%, rgba(4,4,6,0.74) 52%, rgba(4,4,6,0.30) 100%)'}} />
      <div style={{position: 'absolute', left: PAD + 8, top: '50%', transform: `translateY(-50%) translateY(${y}px)`, display: 'flex', gap: 28, maxWidth: 1000}}>
        <div style={{width: 10, background: accent, alignSelf: 'stretch', transform: `scaleY(${Math.max(0.05, wipe)})`, transformOrigin: 'top'}} />
        <div>
          {title ? <div style={{fontFamily: F.serif, fontSize: 58, fontWeight: 700, color: '#ffffff', lineHeight: 1.06}}>{title}</div> : null}
          {body ? <div style={{fontFamily: F.cond, fontSize: 38, fontWeight: 700, color: '#ffffff', lineHeight: 1.2, marginTop: 18, maxWidth: 900}}>{body}</div> : null}
          {source ? <div style={{fontFamily: F.cond, fontSize: 21, fontWeight: 700, color: 'rgba(255,255,255,0.72)', letterSpacing: 2, textTransform: 'uppercase', marginTop: 20}}>{source}</div> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 10) CITA A MÁQUINA ABAJO ("When I was teaching myself…") ───────────────────
const QuoteLine: React.FC<{event: DocEvent}> = ({event}) => {
  const {frame, opacity} = useLife(event.duration);
  const text = clean(event.title || event.subtitle).slice(0, 120);
  const src = clean(event.kicker).slice(0, 50);
  if (!text) return null;
  const chars = Math.floor(interpolate(frame, [4, 4 + text.length * 1.1], [0, text.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: '30%', background: 'linear-gradient(0deg, rgba(0,0,0,0.72), rgba(0,0,0,0))'}} />
      <div style={{position: 'absolute', left: PAD, right: PAD, bottom: PAD - 10, textAlign: 'center'}}>
        <div style={{fontFamily: F.mono, fontSize: 31, color: '#f4efe3', lineHeight: 1.35, textShadow: '0 3px 14px rgba(0,0,0,0.95)', maxWidth: 1240, margin: '0 auto'}}>
          &ldquo;{text.slice(0, chars)}{chars < text.length ? '▌' : '”'}
        </div>
        {src ? <div style={{fontFamily: F.mono, fontSize: 17, color: 'rgba(244,239,227,0.75)', letterSpacing: 1.8, textTransform: 'uppercase', marginTop: 10}}>— {src}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 11) KICKER + TÍTULO ("From Florida To Kentucky / The Call") ────────────────
const TitleKicker: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, y, enter} = useLife(event.duration);
  const title = clean(event.title).slice(0, 40);
  const kicker = clean(event.kicker || event.subtitle).slice(0, 50);
  if (!title) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', left: 0, bottom: 0, width: '70%', height: '40%', background: 'linear-gradient(45deg, rgba(0,0,0,0.6), rgba(0,0,0,0) 70%)'}} />
      <div style={{position: 'absolute', left: PAD, bottom: PAD, transform: `translateY(${y}px)`}}>
        {kicker ? <div style={{fontFamily: F.serif, fontStyle: 'italic', fontSize: 28, color: 'rgba(255,255,255,0.9)', marginBottom: 6, textShadow: '0 3px 14px rgba(0,0,0,0.9)', opacity: enter}}>{kicker}</div> : null}
        <div style={{fontFamily: F.sans, fontSize: 74, fontWeight: 700, color: '#ffffff', lineHeight: 1, textShadow: '0 6px 26px rgba(0,0,0,0.9)'}}>{title}</div>
      </div>
    </AbsoluteFill>
  );
};

// ── 12) PALABRA GIGANTE SOBRE PANEL ("GLOBAL" / "SCRUBBED") ─────────────────────
const StampWord: React.FC<{event: DocEvent}> = ({event}) => {
  const {frame, fps, opacity, enter} = useLife(event.duration);
  const accent = event.accent || '#b5163c';
  const word = clean(event.title).slice(0, 18).toUpperCase();
  const sub = clean(event.subtitle).slice(0, 60);
  if (!word) return null;
  const panel = interpolate(enter, [0, 1], [-60, 0]);
  const erase = interpolate(frame, [Math.round(fps * 1.6), Math.round(fps * 2.6)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const keep = Math.max(1, Math.round(word.length * (1 - erase * 0.35)));
  return (
    <AbsoluteFill style={{opacity, overflow: 'hidden'}}>
      <div style={{position: 'absolute', top: -80, bottom: -80, left: -120, width: '62%', background: accent, transform: `skewX(-9deg) translateX(${panel}%)`, boxShadow: '0 0 80px rgba(0,0,0,0.5)'}} />
      <div style={{position: 'absolute', left: PAD, top: '50%', transform: 'translateY(-50%)'}}>
        <div style={{fontFamily: F.black, fontSize: 150, color: '#ffffff', lineHeight: 0.95, letterSpacing: -2, textShadow: '0 10px 30px rgba(0,0,0,0.45)'}}>
          {word.slice(0, keep)}<span style={{opacity: 0.22}}>{word.slice(keep)}</span>
        </div>
        {sub ? <div style={{fontFamily: F.cond, fontSize: 28, fontWeight: 700, color: '#ffffff', letterSpacing: 2.2, textTransform: 'uppercase', marginTop: 14}}>{sub}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 13) PALABRAS DISPERSAS ("the filing called her / one of the world's most") ──
const KineticWords: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, stagger} = useLife(event.duration);
  const accent = event.accent || '#c9a86a';
  let chunks = items(event, 4);
  if (chunks.length < 2) {
    const words = clean(event.title).split(' ');
    const per = Math.max(2, Math.ceil(words.length / 3));
    chunks = [];
    for (let i = 0; i < words.length; i += per) chunks.push(words.slice(i, i + per).join(' '));
  }
  const slots = [
    {left: '9%', top: '20%', size: 44, font: F.cond, weight: 700, color: '#fff', italic: false},
    {left: '42%', top: '36%', size: 96, font: F.serif, weight: 700, color: '#fff', italic: false},
    {left: '18%', top: '58%', size: 52, font: F.serif, weight: 400, color: accent, italic: true},
    {left: '56%', top: '72%', size: 40, font: F.cond, weight: 700, color: '#fff', italic: false},
  ];
  return (
    <AbsoluteFill style={{opacity}}>
      <AbsoluteFill style={{background: 'rgba(3,3,5,0.55)'}} />
      {chunks.slice(0, 4).map((c, k) => {
        const s = slots[k];
        const p = stagger(k, 9, 12);
        return <div key={k} style={{position: 'absolute', left: s.left, top: s.top, fontFamily: s.font, fontSize: s.size, fontWeight: s.weight as any, fontStyle: s.italic ? 'italic' : 'normal', color: s.color, opacity: p, transform: `translateY(${(1 - p) * 18}px)`, textShadow: '0 4px 20px rgba(0,0,0,0.9)', maxWidth: '50%', lineHeight: 1.05}}>{c}</div>;
      })}
    </AbsoluteFill>
  );
};

// ── 14) DIAGRAMA DE PIEZAS (foto en tarjeta + etiquetas con línea) ─────────────
const PartsDiagram: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, enter, stagger} = useLife(event.duration);
  const {width: W, height: H} = useVideoConfig();
  const labels = items(event, 4);
  const title = clean(event.title).slice(0, 60);
  const src = event.image || '';
  const card = {x: W * 0.32, y: H * 0.24, w: W * 0.36, h: H * 0.48};
  // Posición REAL de cada pieza (targets [x,y] 0..1 dentro de la foto, situados por visión en
  // remotion_graphics). Sin targets: anclas repartidas (solo showcase/demo).
  const tg = ((event as any).targets || []) as number[][];
  const defaults = [
    {ax: card.x + card.w * 0.25, ay: card.y + card.h * 0.3, lx: W * 0.08, ly: H * 0.18},
    {ax: card.x + card.w * 0.8, ay: card.y + card.h * 0.25, lx: W * 0.74, ly: H * 0.14},
    {ax: card.x + card.w * 0.3, ay: card.y + card.h * 0.78, lx: W * 0.1, ly: H * 0.76},
    {ax: card.x + card.w * 0.75, ay: card.y + card.h * 0.8, lx: W * 0.72, ly: H * 0.8},
  ];
  const anchors = labels.map((_, k) => {
    const t = tg[k];
    if (!t || t.length < 2) return defaults[k];
    const ax = card.x + card.w * Math.min(0.97, Math.max(0.03, t[0]));
    const ay = card.y + card.h * Math.min(0.97, Math.max(0.03, t[1]));
    const left = t[0] < 0.5;
    const top = t[1] < 0.5;
    return {ax, ay, lx: left ? W * 0.08 : W * 0.72, ly: (top ? H * 0.14 : H * 0.76) + (k % 2) * 60};
  });
  return (
    <AbsoluteFill style={{opacity, background: '#e7e1d3'}}>
      <Backdrop src={src} dim={0.35} blur={26} />
      <AbsoluteFill style={{opacity: 0.35, backgroundImage: 'linear-gradient(rgba(0,0,0,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.12) 1px, transparent 1px)', backgroundSize: '48px 48px'}} />
      <div style={{position: 'absolute', left: card.x, top: card.y, width: card.w, height: card.h, background: '#fbf9f4', padding: 10, boxShadow: '0 26px 60px rgba(0,0,0,0.35)', transform: `rotate(${-3 + enter * 1}deg) scale(${0.92 + enter * 0.08})`}}>
        {src ? <Img src={media(src)} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : <div style={{width: '100%', height: '100%', background: '#cfc8b8'}} />}
      </div>
      <svg width={W} height={H} style={{position: 'absolute', inset: 0}}>
        {labels.map((_, k) => {
          const a = anchors[k];
          const p = stagger(k, 8, 12);
          return <g key={k} opacity={p}>
            <circle cx={a.ax} cy={a.ay} r={6} fill={INK} />
            <line x1={a.ax} y1={a.ay} x2={a.ax + (a.lx + 120 - a.ax) * p} y2={a.ay + (a.ly + 22 - a.ay) * p} stroke={INK} strokeWidth={2} />
          </g>;
        })}
      </svg>
      {labels.map((l, k) => {
        const a = anchors[k];
        const p = stagger(k, 8, 12);
        return <div key={k} style={{position: 'absolute', left: a.lx, top: a.ly, background: '#ffffff', color: INK, fontFamily: F.cond, fontWeight: 700, fontSize: 22, textTransform: 'uppercase', letterSpacing: 1.2, padding: '8px 14px', boxShadow: '0 8px 20px rgba(0,0,0,0.25)', opacity: p, maxWidth: 260, lineHeight: 1.1}}>{l}</div>;
      })}
      {title ? <div style={{position: 'absolute', left: PAD, bottom: PAD - 16, fontFamily: F.serif, fontSize: 30, color: INK, maxWidth: 900}}>{title}</div> : null}
    </AbsoluteFill>
  );
};

// ── 15) LISTA DE PUNTOS CON CABECERA ("PRODUCTION PRIORITIES") ─────────────────
const TopicList: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, enter, stagger} = useLife(event.duration);
  const accent = event.accent || '#2f6f68';
  const title = clean(event.title).slice(0, 40);
  const pts = items(event, 4);
  if (!title) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', right: 0, top: 0, bottom: 0, width: '52%', background: 'linear-gradient(270deg, rgba(0,0,0,0.62), rgba(0,0,0,0))'}} />
      <div style={{position: 'absolute', right: PAD, top: PAD + 10, textAlign: 'right', transform: `translateY(${(1 - enter) * -16}px)`}}>
        <div style={{display: 'inline-block', background: accent, color: '#ffffff', fontFamily: F.serif, fontWeight: 700, fontSize: 30, letterSpacing: 1.2, textTransform: 'uppercase', padding: '10px 18px'}}>{title}</div>
        <div style={{marginTop: 26, display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-end'}}>
          {pts.map((p, k) => {
            const s = stagger(k, 14, 12);
            return <div key={k} style={{display: 'flex', alignItems: 'center', gap: 16, opacity: s, transform: `translateX(${(1 - s) * 20}px)`}}>
              <span style={{fontFamily: F.cond, fontSize: 30, fontWeight: 700, color: '#ffffff', textShadow: '0 3px 14px rgba(0,0,0,0.9)', maxWidth: 620, textAlign: 'right', lineHeight: 1.1}}>{p}</span>
              <span style={{width: 16, height: 16, borderRadius: 16, background: accent, boxShadow: `0 0 16px ${accent}`}} />
            </div>;
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 16) FOTO INSET SOBRE METRAJE ("Sturmgewehr 44: Assault Rifle") ─────────────
const PhotoInset: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, enter} = useLife(event.duration);
  const src = event.image || '';
  const caption = clean(event.title).slice(0, 60);
  const right = (event.side || 'left') === 'right';
  if (!src) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', bottom: PAD, ...(right ? {right: PAD} : {left: PAD}), width: '30%', transform: `translateY(${(1 - enter) * 40}px) rotate(${right ? 1.6 : -1.6}deg)`}}>
        <div style={{background: '#f7f4ec', padding: 8, boxShadow: '0 20px 44px rgba(0,0,0,0.55)'}}>
          <Img src={media(src)} style={{width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block'}} />
        </div>
        {caption ? <div style={{fontFamily: F.serif, fontStyle: 'italic', fontSize: 24, color: '#ffffff', marginTop: 12, textShadow: '0 3px 14px rgba(0,0,0,0.95)', textAlign: right ? 'right' : 'left'}}>{caption}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 17) POLAROID CENTRADA CON PIE ("SEASONAL SWINGS FADE") ─────────────────────
const PhotoCaption: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, enter} = useLife(event.duration);
  const src = event.image || '';
  const caption = clean(event.title).slice(0, 50);
  if (!src) return null;
  return (
    <AbsoluteFill style={{opacity, background: '#101010'}}>
      <Backdrop src={src} />
      <AbsoluteFill style={{opacity: 0.07, backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '52px 52px'}} />
      <div style={{position: 'absolute', left: '50%', top: '46%', transform: `translate(-50%, -50%) scale(${0.9 + enter * 0.1}) rotate(-1.5deg)`, width: '46%'}}>
        <div style={{background: '#f4f1ea', padding: 10, boxShadow: '0 26px 60px rgba(0,0,0,0.6)'}}>
          <Img src={media(src)} style={{width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block', filter: 'contrast(1.05) saturate(0.85)'}} />
        </div>
      </div>
      {caption ? <div style={{position: 'absolute', left: 0, right: 0, bottom: '9%', textAlign: 'center', fontFamily: F.cond, fontSize: 30, fontWeight: 700, color: '#ffffff', letterSpacing: 2.4, textTransform: 'uppercase'}}>{caption}</div> : null}
    </AbsoluteFill>
  );
};

// ── 18) TIMELINE DE HITOS ("1890 · Fundación") ─────────────────────────────────
const YearTimeline: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, wipe, stagger} = useLife(event.duration);
  const {width: W, height: H} = useVideoConfig();
  const accent = event.accent || '#c9a86a';
  const its = items(event, 5).map((s) => {
    const m = s.match(/^\s*([^:·|—–-]{2,12})\s*[:·|—–-]\s*(.+)$/);
    return m ? {year: m[1].trim(), label: m[2].trim()} : {year: s.split(' ')[0], label: s.split(' ').slice(1).join(' ')};
  });
  if (its.length < 2) return null;
  const y = H * 0.62;
  const x0 = W * 0.12;
  const x1 = W * 0.88;
  return (
    <AbsoluteFill style={{opacity}}>
      <AbsoluteFill style={{background: 'rgba(3,3,5,0.5)'}} />
      {clean(event.title) ? <div style={{position: 'absolute', left: PAD, top: PAD, fontFamily: F.cond, fontSize: 22, fontWeight: 700, color: accent, letterSpacing: 3, textTransform: 'uppercase'}}>{clean(event.title).slice(0, 40)}</div> : null}
      <svg width={W} height={H} style={{position: 'absolute', inset: 0}}>
        <line x1={x0} y1={y} x2={x0 + (x1 - x0) * wipe} y2={y} stroke="#ffffff" strokeWidth={2} opacity={0.8} />
        {its.map((_, k) => {
          const x = x0 + ((x1 - x0) * k) / (its.length - 1);
          const p = stagger(k, 10, 10);
          return <circle key={k} cx={x} cy={y} r={9 * p} fill={accent} />;
        })}
      </svg>
      {its.map((it, k) => {
        const x = x0 + ((x1 - x0) * k) / (its.length - 1);
        const p = stagger(k, 10, 10);
        return <div key={k} style={{position: 'absolute', left: x, top: y, transform: 'translateX(-50%)', textAlign: 'center', opacity: p, width: 300}}>
          <div style={{fontFamily: F.serif, fontSize: 46, fontWeight: 700, color: '#ffffff', position: 'absolute', bottom: 26, left: 0, right: 0, textShadow: '0 4px 18px rgba(0,0,0,0.9)'}}>{it.year}</div>
          <div style={{fontFamily: F.cond, fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.9)', position: 'absolute', top: 26, left: 0, right: 0, letterSpacing: 0.6, lineHeight: 1.15, textTransform: 'uppercase'}}>{it.label.slice(0, 40)}</div>
        </div>;
      })}
    </AbsoluteFill>
  );
};

// ── 19) PUNTO DE AÑO SOBRE LÍNEA ("2026") ──────────────────────────────────────
const YearDot: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, wipe, enter} = useLife(event.duration);
  const {width: W, height: H} = useVideoConfig();
  const title = clean(event.title).slice(0, 16);
  const sub = clean(event.subtitle).slice(0, 40);
  if (!title) return null;
  const cx = W * clamp01(event.targetX, 0.5);
  const cy = H * 0.58;
  return (
    <AbsoluteFill style={{opacity}}>
      <svg width={W} height={H} style={{position: 'absolute', inset: 0}}>
        <line x1={cx - 420 * wipe} y1={cy} x2={cx + 420 * wipe} y2={cy} stroke="#ffffff" strokeWidth={1.5} opacity={0.85} />
        <circle cx={cx} cy={cy} r={9 * enter} fill="#ffffff" />
      </svg>
      <div style={{position: 'absolute', left: cx, top: cy - 70, transform: 'translateX(-50%)', fontFamily: F.sans, fontSize: 34, fontWeight: 700, color: '#ffffff', textShadow: '0 3px 14px rgba(0,0,0,0.95)', opacity: enter}}>{title}</div>
      {sub ? <div style={{position: 'absolute', left: cx, top: cy + 22, transform: 'translateX(-50%)', fontFamily: F.cond, fontSize: 20, color: 'rgba(255,255,255,0.85)', letterSpacing: 1.2, textTransform: 'uppercase', opacity: enter}}>{sub}</div> : null}
    </AbsoluteFill>
  );
};

// ── 20) DOS FOTOS EN CÍRCULO SOBRE ACENTO ──────────────────────────────────────
const CircleCompare: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, enter, stagger} = useLife(event.duration);
  const accent = event.accent || '#b5163c';
  const its = items(event, 2);
  const srcs = [event.image, event.image2].filter(Boolean) as string[];
  if (!srcs.length) return null;
  return (
    <AbsoluteFill style={{opacity, background: accent}}>
      <Backdrop src={srcs[0]} dim={0.5} blur={30} />
      <AbsoluteFill style={{background: accent, opacity: 0.55}} />
      <div style={{position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 120}}>
        {srcs.slice(0, 2).map((s, k) => {
          const p = stagger(k, 10, 12);
          return <div key={k} style={{textAlign: 'center', opacity: p, transform: `scale(${0.85 + p * 0.15})`}}>
            <div style={{width: 380, height: 380, borderRadius: 380, overflow: 'hidden', boxShadow: '0 30px 70px rgba(0,0,0,0.45)', border: '6px solid rgba(255,255,255,0.9)'}}>
              <Img src={media(s)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
            </div>
            {its[k] ? <div style={{marginTop: 22, fontFamily: F.cond, fontSize: 30, fontWeight: 700, color: '#ffffff', letterSpacing: 2, textTransform: 'uppercase'}}>{its[k]}</div> : null}
          </div>;
        })}
      </div>
      {clean(event.title) ? <div style={{position: 'absolute', left: 0, right: 0, bottom: PAD - 10, textAlign: 'center', fontFamily: F.serif, fontSize: 34, color: '#ffffff', opacity: enter}}>{clean(event.title).slice(0, 60)}</div> : null}
    </AbsoluteFill>
  );
};

// ── 21) PERFIL DE SUJETO CON CARACTERÍSTICAS (HAROLD & HELEN KITE + lista) ─────
const SubjectProfile: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, enter, stagger} = useLife(event.duration);
  const accent = event.accent || '#d62839';
  const name = clean(event.title).slice(0, 40);
  const role = clean(event.subtitle).slice(0, 60);
  const kicker = clean(event.kicker).slice(0, 30);
  const facts = items(event, 4);
  const src = event.image || '';
  if (!name) return null;
  return (
    <AbsoluteFill style={{opacity, background: '#0b0b0d'}}>
      <Backdrop src={event.image2 || src} dim={0.72} />
      <AbsoluteFill style={{opacity: 0.06, backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '52px 52px'}} />
      <div style={{position: 'absolute', left: '9%', top: '50%', width: 420, height: 420, borderRadius: 420, background: accent, filter: 'blur(40px)', opacity: 0.55, transform: 'translateY(-50%)'}} />
      {src ? (
        <div style={{position: 'absolute', left: '9%', top: '16%', width: '30%', height: '68%', background: '#f4f1ea', padding: 8, boxShadow: '0 26px 60px rgba(0,0,0,0.6)', transform: `translateY(${(1 - enter) * 40}px) rotate(-1.5deg)`}}>
          <Img src={media(src)} style={{width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(0.9) contrast(1.1)'}} />
        </div>
      ) : null}
      <div style={{position: 'absolute', left: src ? '46%' : '12%', top: '50%', transform: 'translateY(-50%)', maxWidth: '46%'}}>
        {kicker ? <div style={{fontFamily: F.cond, fontSize: 18, fontWeight: 700, letterSpacing: 3.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)', marginBottom: 14}}>{kicker}</div> : null}
        <div style={{fontFamily: F.black, fontSize: 64, lineHeight: 0.98, color: accent, textTransform: 'uppercase', letterSpacing: -1.5}}>{name}</div>
        {role ? <div style={{fontFamily: F.cond, fontSize: 26, fontWeight: 700, color: '#ffffff', marginTop: 12, letterSpacing: 0.6}}>{role}</div> : null}
        {facts.length ? <div style={{marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10}}>
          {facts.map((f, k) => {
            const p = stagger(k, 9, 12);
            return <div key={k} style={{display: 'flex', gap: 14, alignItems: 'baseline', opacity: p, transform: `translateX(${(1 - p) * 16}px)`}}>
              <span style={{width: 18, height: 3, background: accent, flexShrink: 0, transform: 'translateY(-7px)'}} />
              <span style={{fontFamily: F.cond, fontSize: 25, fontWeight: 700, color: '#f2efe8', lineHeight: 1.15}}>{f}</span>
            </div>;
          })}
        </div> : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 22) BADGE DE RANKING ("#14") ───────────────────────────────────────────────
const RankBadge: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, enter} = useLife(event.duration);
  const accent = event.accent || '#f2c230';
  const n = event.rank && event.rank > 0 ? String(event.rank) : (clean(event.title).match(/\d{1,3}/) || [''])[0];
  const label = clean(event.subtitle || (event.rank ? event.title : '')).slice(0, 44);
  if (!n) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', left: PAD, bottom: PAD, display: 'flex', alignItems: 'stretch', transform: `translateY(${(1 - enter) * 30}px)`}}>
        <div style={{background: accent, color: INK, fontFamily: F.black, fontSize: 78, lineHeight: 1, padding: '14px 24px 10px', boxShadow: '0 12px 30px rgba(0,0,0,0.55)'}}>#{n}</div>
        {label ? <div style={{background: 'rgba(10,10,12,0.9)', color: '#ffffff', fontFamily: F.cond, fontSize: 30, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.4, padding: '0 26px', display: 'flex', alignItems: 'center', maxWidth: 620, lineHeight: 1.1}}>{label}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 23) DOCUMENTO CON FRASE RESALTADA ──────────────────────────────────────────
const DocHighlight: React.FC<{event: DocEvent}> = ({event}) => {
  const {frame, fps, opacity, enter} = useLife(event.duration);
  const accent = event.accent || '#f2c230';
  const src = event.image || '';
  const caption = clean(event.title).slice(0, 60);
  if (!src) return null;
  const tx = clamp01(event.targetX, 0.5);
  const ty = clamp01(event.targetY, 0.5);
  const zoom = interpolate(frame, [0, fps * 6], [1.02, 1.12], {extrapolateRight: 'clamp'});
  const hl = interpolate(frame, [Math.round(fps * 0.6), Math.round(fps * 1.4)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{opacity, background: '#171512', overflow: 'hidden'}}>
      <Img src={media(src)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})`, transformOrigin: `${tx * 100}% ${ty * 100}%`, filter: 'contrast(1.05)'}} />
      <div style={{position: 'absolute', left: `${Math.max(4, tx * 100 - 28)}%`, top: `${ty * 100 - 2.2}%`, width: `${56 * hl}%`, height: '4.4%', background: accent, opacity: 0.55, mixBlendMode: 'multiply'}} />
      {caption ? <div style={{position: 'absolute', left: PAD, bottom: PAD, background: PAPER, color: INK, fontFamily: F.cond, fontSize: 32, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, padding: '12px 22px', borderLeft: `8px solid ${accent}`, boxShadow: '0 14px 32px rgba(0,0,0,0.55)', opacity: enter}}>{caption}</div> : null}
    </AbsoluteFill>
  );
};

// ── 24) TEXTO ROJO DESLIZANTE SOBRE REJILLA ("…er Haven regulars crowned") ─────
const TickerWord: React.FC<{event: DocEvent}> = ({event}) => {
  const {frame, fps, opacity} = useLife(event.duration);
  const {width: W} = useVideoConfig();
  const accent = event.accent || '#e0122f';
  const text = clean(event.title).slice(0, 60);
  if (!text) return null;
  const x = interpolate(frame, [0, fps * 5.5], [W * 0.55, -W * 0.55], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{opacity, overflow: 'hidden'}}>
      <AbsoluteFill style={{background: 'rgba(4,4,6,0.9)'}} />
      <AbsoluteFill style={{opacity: 0.1, backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '64px 64px'}} />
      <div style={{position: 'absolute', top: '50%', left: '50%', transform: `translate(-50%, -50%) translateX(${x}px)`, whiteSpace: 'nowrap', fontFamily: F.sans, fontWeight: 700, fontSize: 96, color: accent, letterSpacing: 1, textShadow: `0 0 30px ${accent}55`}}>
        {text}
      </div>
    </AbsoluteFill>
  );
};

// ── 25) TIRA DE FOTOS NUMERADAS ("#2 #3 #4" en marcos amarillos) ───────────────
const PhotoStrip: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, stagger} = useLife(event.duration);
  const accent = event.accent || '#f2c230';
  const labels = items(event, 3);
  const srcs = [event.image, event.image2, event.image].filter(Boolean) as string[];
  const n = Math.max(2, Math.min(3, Math.max(labels.length, srcs.length >= 2 ? 3 : 2)));
  if (!srcs.length) return null;
  const startN = event.rank && event.rank > 0 ? event.rank : 1;
  return (
    <AbsoluteFill style={{opacity, background: '#0f0f10'}}>
      <Backdrop src={srcs[0]} dim={0.7} />
      <AbsoluteFill style={{opacity: 0.08, backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '52px 52px'}} />
      <div style={{position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 40, padding: '0 80px'}}>
        {Array.from({length: n}, (_, k) => {
          const p = stagger(k, 8, 12);
          return <div key={k} style={{width: `${Math.floor(88 / n)}%`, opacity: p, transform: `translateY(${(1 - p) * 30}px)`, position: 'relative'}}>
            <div style={{border: `5px solid ${accent}`, background: '#000', boxShadow: '0 20px 44px rgba(0,0,0,0.6)'}}>
              <Img src={media(srcs[k % srcs.length])} style={{width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block', filter: 'contrast(1.05)'}} />
            </div>
            <div style={{position: 'absolute', left: -14, bottom: -14, background: accent, color: INK, fontFamily: F.black, fontSize: 30, padding: '4px 12px', lineHeight: 1}}>#{startN + k}</div>
            {labels[k] ? <div style={{marginTop: 22, textAlign: 'center', fontFamily: F.cond, fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: 1.6, textTransform: 'uppercase'}}>{labels[k]}</div> : null}
          </div>;
        })}
      </div>
      {clean(event.title) ? <div style={{position: 'absolute', left: 0, right: 0, bottom: PAD - 14, textAlign: 'center', fontFamily: F.serif, fontSize: 32, color: '#fff'}}>{clean(event.title).slice(0, 60)}</div> : null}
    </AbsoluteFill>
  );
};

// ── 26) ETIQUETA CENTRAL PEQUEÑA ("AMISH FOOD STORAGE / EARTH-BASE") ───────────
const CenterLabel: React.FC<{event: DocEvent}> = ({event}) => {
  const {opacity, y} = useLife(event.duration);
  const title = clean(event.title).slice(0, 40);
  const sub = clean(event.subtitle).slice(0, 40);
  if (!title) return null;
  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: PAD + 10, textAlign: 'center', transform: `translateY(${y}px)`}}>
        <div style={{fontFamily: F.cond, fontSize: 34, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: 2.2, textShadow: '0 3px 16px rgba(0,0,0,0.95)'}}>{title}</div>
        {sub ? <div style={{fontFamily: F.cond, fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: 3.4, marginTop: 6, textShadow: '0 2px 12px rgba(0,0,0,0.95)'}}>{sub}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 27) NÚMERO/PALABRA CON GLITCH ("50S", "WITHOUT REFR") ──────────────────────
const GlitchNumber: React.FC<{event: DocEvent}> = ({event}) => {
  const {frame, fps, opacity} = useLife(event.duration);
  const text = clean(event.title).slice(0, 14).toUpperCase();
  const sub = clean(event.subtitle).slice(0, 50);
  if (!text) return null;
  const chars = Math.floor(interpolate(frame, [0, Math.round(fps * 0.9)], [0, text.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
  const g = frame < fps * 0.8 ? Math.sin(frame * 7.3) * 6 : 0;
  const shown = text.slice(0, chars);
  return (
    <AbsoluteFill style={{opacity}}>
      <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(0,0,0,0.6), rgba(0,0,0,0.15))'}} />
      <div style={{position: 'absolute', left: PAD, top: '50%', transform: 'translateY(-50%)'}}>
        <div style={{position: 'relative', fontFamily: F.num, fontSize: 220, lineHeight: 0.9, color: '#fff', letterSpacing: 2}}>
          <span style={{position: 'absolute', left: g, top: -g * 0.4, color: '#ff2a6d', opacity: g ? 0.75 : 0, mixBlendMode: 'screen'}}>{shown}</span>
          <span style={{position: 'absolute', left: -g, top: g * 0.4, color: '#1de1ff', opacity: g ? 0.75 : 0, mixBlendMode: 'screen'}}>{shown}</span>
          <span style={{position: 'relative'}}>{shown}<span style={{opacity: chars < text.length ? 1 : 0}}>▌</span></span>
        </div>
        {sub ? <div style={{fontFamily: F.cond, fontSize: 30, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: 2.2, marginTop: 10, textShadow: '0 3px 14px rgba(0,0,0,0.9)'}}>{sub}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 28) RECUADRO BLANCO SOBRE UNA ZONA DEL PLANO ("LOCKED BREECH") ─────────────
const FrameBox: React.FC<{event: DocEvent}> = ({event}) => {
  const {frame, fps, opacity} = useLife(event.duration);
  const {width: W, height: H} = useVideoConfig();
  const title = clean(event.title).slice(0, 34);
  const b = (event.box && event.box.length === 4) ? event.box : [0.3, 0.25, 0.7, 0.75];
  const x1 = W * Math.min(b[0], b[2]);
  const y1 = H * Math.min(b[1], b[3]);
  const x2 = W * Math.max(b[0], b[2]);
  const y2 = H * Math.max(b[1], b[3]);
  const draw = interpolate(frame, [2, 2 + Math.round(fps * 0.5)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const per = 2 * ((x2 - x1) + (y2 - y1));
  return (
    <AbsoluteFill style={{opacity}}>
      <svg width={W} height={H} style={{position: 'absolute', inset: 0}}>
        <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="none" stroke="#ffffff" strokeWidth={4} strokeDasharray={per} strokeDashoffset={per * (1 - draw)} />
      </svg>
      {title ? <div style={{position: 'absolute', left: x1, top: Math.max(20, y1 - 56), background: WHITE_BOX, color: INK, fontFamily: F.cond, fontSize: 24, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, padding: '8px 16px', opacity: draw, whiteSpace: 'nowrap', boxShadow: '0 8px 20px rgba(0,0,0,0.5)'}}>{title}</div> : null}
    </AbsoluteFill>
  );
};

export const DocumentaryMotion: React.FC<{event: DocEvent}> = ({event}) => {
  switch (event.type) {
    case 'ticker_word': return <TickerWord event={event} />;
    case 'photo_strip': return <PhotoStrip event={event} />;
    case 'center_label': return <CenterLabel event={event} />;
    case 'glitch_number': return <GlitchNumber event={event} />;
    case 'frame_box': return <FrameBox event={event} />;
    case 'big_stat_doc': return <BigStatDoc event={event} />;
    case 'echo_title': return <EchoTitle event={event} />;
    case 'caption_bar': return <CaptionBar event={event} />;
    case 'paper_tag': return <PaperTag event={event} />;
    case 'callout_label': return <CalloutLabel event={event} />;
    case 'tag_label': return <TagLabel event={event} />;
    case 'label_pair': return <LabelPair event={event} />;
    case 'date_stamp': return <DateStamp event={event} />;
    case 'quote_card': return <QuoteCard event={event} />;
    case 'quote_line': return <QuoteLine event={event} />;
    case 'title_kicker': return <TitleKicker event={event} />;
    case 'stamp_word': return <StampWord event={event} />;
    case 'kinetic_words': return <KineticWords event={event} />;
    case 'parts_diagram': return <PartsDiagram event={event} />;
    case 'topic_list': return <TopicList event={event} />;
    case 'photo_inset': return <PhotoInset event={event} />;
    case 'photo_caption': return <PhotoCaption event={event} />;
    case 'year_timeline': return <YearTimeline event={event} />;
    case 'year_dot': return <YearDot event={event} />;
    case 'circle_compare': return <CircleCompare event={event} />;
    case 'subject_profile': return <SubjectProfile event={event} />;
    case 'rank_badge': return <RankBadge event={event} />;
    case 'doc_highlight': return <DocHighlight event={event} />;
    default: return null;
  }
};
