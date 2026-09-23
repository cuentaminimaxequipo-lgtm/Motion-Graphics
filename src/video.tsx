import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {GeoMap} from './geomap';
import {isVidrushType, VidrushMotion} from './vidrush-motion';
import {isDocumentaryType, DocumentaryMotion} from './documentary-motion';

// ─────────────────────────────────────────────────────────────────────────────
// MOTION GRAPHICS — set LIMPIO y natural (estilo documental tipo Eli Yoder /
// doc militar Top-5): overlays SOBRE el metraje real, oscuros y semitransparentes,
// acento DORADO, tipografía clara. Nada de escenas 3D/UI falsas que tapen el vídeo.
// Plantillas: lower_third (etiqueta), stat (cifra), ranking (#N), section_title,
// spec_panel (panel de bullets a un lado). renderEvent mapea cualquier tipo del
// planner a una de estas 5.
// ─────────────────────────────────────────────────────────────────────────────

type MotionEvent = {
  id: string;
  type: string;
  start: number;
  duration: number;
  title: string;
  subtitle?: string;
  kicker?: string;
  items?: string[];
  design?: string;
  objectHint?: string;
  rank?: number;
  side?: 'left' | 'right' | 'center';
  accent?: string;
  // FORMA de la gráfica, sellada por Python (_chart_window): 'line' = serie de AÑOS (tendencia,
  // ya ordenada cronológicamente) → <LineChart>; 'bars'/vacío = comparación → <Chart>.
  // Los DATOS son los mismos en ambos casos; esto solo elige cómo se leen mejor.
  chartKind?: string;
  // Esquemas Constructum/VidRush: la familia decide la geometría, no solo el texto.
  schematicKind?: string;
  // CloudMapZoom (mapa satélite con descenso desde las nubes):
  image?: string;            // ruta/URL del mapa de RELIEVE (staticFile — Chromium NO carga file://)
  targetX?: number;          // 0..1 posición horizontal de la localización en el mapa
  targetY?: number;          // 0..1 posición vertical de la localización en el mapa
  locName?: string;          // etiqueta del pin (p.ej. "París", "Tokio")
  flag?: string;             // ruta/URL de la imagen de la BANDERA (se stagea a public)
  outline?: number[][];      // contorno del país [[x,y],...] 0..1 (proyectado por scripts/geo_outline)
  // mapStyle — ESTILO DEL MAPA (rotación decidida en Python; MOTION_MAP_STYLE=auto|vector|clouds):
  //   'vector'            → GeoMap vectorial MINIMALISTA (el look aprobado): tierra gris, océano
  //                         azul-noche, país contorneado en el acento, pin y cámara. Es también el
  //                         comportamiento por defecto/legacy de cualquier evento con datos geo.
  //   'clouds'            → CloudMapZoom: DESCENSO entre nubes sobre mapa ráster (look moderno).
  //                         Exige `image` (ráster preparado por map_prep) + targetX/targetY.
  //   'modern'|'natural'  → grade del ráster de siempre (nav neón / satélite doc), sin cambios.
  mapStyle?: string;
  routeToX?: number;         // 0..1 destino de la RUTA luminosa (opcional)
  routeToY?: number;
  routeToName?: string;      // etiqueta del destino de la ruta
  image2?: string;           // VOX: recorte de PRIMER plano (edificio/objeto, a color)
  // GeoMap (MAPA VECTORIAL d3-geo/world-atlas — formas reales de países, cámara continua):
  focusName?: string;                                   // país a enfocar (nombre EN de world-atlas)
  highlight?: {name: string; color: string}[];          // países a teñir con color de bandera
  markers?: {lon: number; lat: number; label?: string; color?: string}[];
  geoRoute?: {fromLon: number; fromLat: number; toLon: number; toLat: number; color?: string; strike?: boolean};
};

export type PipelineMotionProps = {
  videoSrc: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  style: 'low' | 'mid' | 'high';
  events: MotionEvent[];
};

// TEMAS por nicho (como las "brand profiles" de VidRush): cada uno fija TIPOGRAFÍA + COLORES
// + si va en MAYÚSCULAS. Así los textos tienen el look del nicho (documental serif/crema,
// terror rojo, historia sepia…) y NO son siempre iguales. El canal elige el tema (ch.remotionTheme).
type Theme = {font: string; accent: string; panel: string; panelText: string; over: string; upper: boolean;
  // EMPAREJAMIENTO TIPOGRÁFICO (2026-07-15, el usuario: "varias tipografías que salgan bien,
  // números, animaciones con números"): fontNum = fuente SOLO para cifras (BebasNeue: dígitos
  // altos, condensados y limpios → los stats no parecen IA). fontDisplay = títulos de impacto.
  // Si no se define, caen a `font` (comportamiento anterior intacto).
  fontNum?: string; fontDisplay?: string; fontBody?: string; fontLabel?: string;
  // TÁCTICO (estilo Beyond Military): badge = etiqueta de dato con FONDO de acento sólido y
  // texto oscuro (badgeInk), esquinas vivas, entrada rápida. snappy = fade corto (~6 frames).
  badge?: boolean; badgeInk?: string; snappy?: boolean};
const THEMES: Record<string, Theme> = {
  // Emparejamiento tipográfico por tema (2026-07-16): fontDisplay = titular de impacto,
  // fontLabel = compañera condensada limpia (lower-thirds/kickers/bullets). Los serif (Playfair)
  // mantienen su titular elegante y añaden un sans limpio para etiquetas; los display pesados
  // llevan Anton en titulares + Oswald/Barlow en etiquetas → 3-4 fuentes por vídeo, coherentes.
  documentary: {font: "'PlayfairDisplay', Georgia, serif", accent: '#c9a86a', panel: 'rgba(233,227,213,0.96)', panelText: '#2b261d', over: '#f4efe3', upper: false, fontLabel: "'BarlowCondensed', 'Oswald', sans-serif"},
  history:     {font: "'PlayfairDisplay', Georgia, serif", accent: '#caa15a', panel: 'rgba(28,22,14,0.90)', panelText: '#f1e7d2', over: '#f3ead6', upper: false, fontLabel: "'Oswald', Inter, sans-serif"},
  crime:       {font: "'Anton', 'Arial Black', sans-serif", accent: '#e23b3b', panel: 'rgba(10,10,12,0.90)', panelText: '#f4f4f4', over: '#ffffff', upper: true, fontDisplay: "'Anton', 'Arial Black', sans-serif", fontLabel: "'BarlowCondensed', 'Oswald', sans-serif"},
  // TRUE CRIME (2026-07-17) — el look APROBADO por el usuario (demo del esquema del túnel):
  // titular SERIF de resaltador rojo sobre azul-noche, minúsculas (upper:false) → NO es Anton.
  // Se separa de `crime` (Anton/mayúsculas) en vez de tocarlo: quien ya usa 'crime' no cambia.
  truecrime:   {font: "'PlayfairDisplay', Georgia, serif", accent: '#e23b3b', panel: 'rgba(9,12,20,0.92)', panelText: '#f2f4f8', over: '#ffffff', upper: false, fontDisplay: "'PlayfairDisplay', Georgia, serif", fontLabel: "'BarlowCondensed', 'Oswald', sans-serif", fontNum: "'BebasNeue', 'Oswald', sans-serif"},
  geography:   {font: "'Oswald', Inter, sans-serif", accent: '#37b6c7', panel: 'rgba(8,16,20,0.90)', panelText: '#eaf6f8', over: '#ffffff', upper: true, fontDisplay: "'Anton', 'Arial Black', sans-serif", fontLabel: "'Oswald', Inter, sans-serif"},
  modern:      {font: "'Oswald', Inter, sans-serif", accent: '#D4A76A', panel: 'rgba(8,11,16,0.86)', panelText: '#ffffff', over: '#ffffff', upper: true, fontDisplay: "'Anton', 'Arial Black', sans-serif", fontLabel: "'Oswald', Inter, sans-serif"},
  minimal:     {font: "'BarlowCondensed', Inter, sans-serif", accent: '#ffffff', panel: 'rgba(0,0,0,0.50)', panelText: '#ffffff', over: '#ffffff', upper: false},
  standard:    {font: "'Oswald', Inter, sans-serif", accent: '#D4A76A', panel: 'rgba(8,11,16,0.84)', panelText: '#ffffff', over: '#ffffff', upper: true, fontDisplay: "'Anton', 'Arial Black', sans-serif", fontLabel: "'Oswald', Inter, sans-serif"},
  // Nichos adicionales (brandeados por defecto, estilo VidRush): militar (oliva/caqui),
  // naturaleza (verde), ciencia/espacio (azul-cian), negocios/finanzas (azul marino+dorado).
  // MILITAR = estilo "Beyond Military": badges AMARILLOS vibrantes con texto NEGRO, peso
  // black, mayúsculas, entrada rápida (look táctico/noticiero de defensa, no oliva apagado).
  military:    {font: "'Anton', 'Arial Black', sans-serif", accent: '#ffe000', panel: 'rgba(10,12,10,0.92)', panelText: '#f4f2e6', over: '#ffffff', upper: true, badge: true, badgeInk: '#0b0b0b', snappy: true, fontDisplay: "'Anton', 'Arial Black', sans-serif", fontLabel: "'BarlowCondensed', 'Oswald', sans-serif"},
  nature:      {font: "'BarlowCondensed', Inter, sans-serif", accent: '#5cbf73', panel: 'rgba(9,19,12,0.90)', panelText: '#e8f6ea', over: '#ffffff', upper: false},
  science:     {font: "'Oswald', Inter, sans-serif", accent: '#4aa8ff', panel: 'rgba(7,12,22,0.92)', panelText: '#e8f0ff', over: '#ffffff', upper: true, fontDisplay: "'Anton', 'Arial Black', sans-serif", fontLabel: "'Oswald', Inter, sans-serif"},
  business:    {font: "'PlayfairDisplay', Georgia, serif", accent: '#c9a86a', panel: 'rgba(13,17,27,0.92)', panelText: '#eaf0f8', over: '#ffffff', upper: false, fontLabel: "'Oswald', Inter, sans-serif"},
  // ── TEMAS AÑADIDOS (2026-07-17, el usuario: "aplica lo de que puedes elegir varias tipografías
  // por defecto, ponle varias tipografías tú también") ─────────────────────────────────────────
  // Las 6 premium cargadas (fonts.ts) estaban infrautilizadas (ArchivoBlack no lo usaba NADIE y
  // BebasNeue solo salía en cifras). Estos temas son EMPAREJAMIENTOS nuevos y distintos entre sí:
  // un canal solo tiene que elegir (ch.remotionTheme → PIPELINE_MOTION_THEME). NO tocan los temas
  // ya en uso (documentary/crime/truecrime/military…).
  // ⚠ Cada acento debe espejarse en `_THEME_ACCENTS` (scripts/remotion_graphics.py): Python
  // resuelve el acento y `event.accent` GANA en el render — sin espejo, el tema sale de otro color.
  //
  // EDITORIAL — revista/ensayo: serif Playfair en titulares Y EN LAS CIFRAS (números old-style,
  // nada de Bebas), etiquetas en Barlow condensada. Papel crema, tinta roja. (Se distingue de
  // `documentary`: allí el acento es dorado y las cifras van en Bebas.)
  editorial:   {font: "'PlayfairDisplay', Georgia, serif", accent: '#b23a2e', panel: 'rgba(244,240,231,0.96)', panelText: '#211d18', over: '#f7f2e7', upper: false, fontDisplay: "'PlayfairDisplay', Georgia, serif", fontLabel: "'BarlowCondensed', 'Oswald', sans-serif", fontNum: "'PlayfairDisplay', Georgia, serif"},
  // IMPACT — golpe visual: ArchivoBlack (grotesca ultra-negra, geométrica) en titulares Y cifras,
  // Oswald para etiquetas. Naranja sobre negro, entrada rápida (snappy).
  impact:      {font: "'ArchivoBlack', 'Arial Black', sans-serif", accent: '#ff5a1f', panel: 'rgba(12,12,14,0.92)', panelText: '#f6f6f6', over: '#ffffff', upper: true, snappy: true, fontDisplay: "'ArchivoBlack', 'Arial Black', sans-serif", fontLabel: "'Oswald', Inter, sans-serif", fontNum: "'ArchivoBlack', 'Arial Black', sans-serif"},
  // NEWSROOM — condensada limpia (informativo/actualidad): Oswald en titulares, Barlow condensada
  // en etiquetas, Bebas en cifras. Azul de rótulo sobre pizarra.
  newsroom:    {font: "'BarlowCondensed', Inter, sans-serif", accent: '#2f7de1', panel: 'rgba(10,14,22,0.90)', panelText: '#eef3fb', over: '#ffffff', upper: true, fontDisplay: "'Oswald', Inter, sans-serif", fontLabel: "'BarlowCondensed', Inter, sans-serif"},
  // SPORT — marcador: BebasNeue de DISPLAY (no solo en cifras) + Barlow condensada de etiqueta.
  // Verde de campo sobre negro, entrada rápida.
  sport:       {font: "'BebasNeue', 'Oswald', sans-serif", accent: '#26d07c', panel: 'rgba(8,14,11,0.90)', panelText: '#eafbf1', over: '#ffffff', upper: true, snappy: true, fontDisplay: "'BebasNeue', 'Oswald', sans-serif", fontLabel: "'BarlowCondensed', 'Oswald', sans-serif"},
  // CONSTRUCTUM / VIDRUSH — ingeniería y documental técnico. El metraje sigue siendo
  // protagonista; el naranja solo señala una cifra, fecha, elemento o conclusión.
  // Se usa como perfil por defecto del preset VidRush cuando el canal no fija otro tema.
  constructum: {font: "'BarlowCondensed', 'Oswald', 'Arial Narrow', sans-serif", accent: '#F2A51A', panel: 'rgba(8,14,22,0.90)', panelText: '#f7f8fb', over: '#ffffff', upper: true, fontDisplay: "'Oswald', 'Arial Narrow', sans-serif", fontLabel: "'BarlowCondensed', 'Oswald', sans-serif", fontNum: "'Anton', 'Arial Black', sans-serif"},
};
// Alias por si el canal usa otros nombres (terror→crime, geografía→geography…).
const THEME_ALIAS: Record<string, string> = {
  terror: 'crime',
  // true crime / narco → tema `truecrime` (serif Playfair + rojo), NO el `crime` de Anton.
  truecrime: 'truecrime', 'true-crime': 'truecrime', narco: 'truecrime', crimen: 'truecrime',
  historia: 'history',
  geografia: 'geography', 'geografía': 'geography', documental: 'documentary',
  moderno: 'modern', minimalista: 'minimal', estandar: 'standard', 'estándar': 'standard',
  militar: 'military', guerra: 'military', belico: 'military', 'bélico': 'military', war: 'military',
  naturaleza: 'nature', natura: 'nature', wildlife: 'nature', animales: 'nature',
  ciencia: 'science', espacio: 'science', space: 'science', cosmos: 'science', tecnologia: 'science',
  negocios: 'business', finanzas: 'business', economia: 'business', 'economía': 'business', dinero: 'business',
  // Alias de los temas AÑADIDOS (2026-07-17). Espejados en _THEME_ACCENTS (remotion_graphics.py).
  editorial: 'editorial', revista: 'editorial', magazine: 'editorial', prensa: 'editorial',
  ensayo: 'editorial', articulo: 'editorial', 'artículo': 'editorial', reportaje: 'editorial',
  impact: 'impact', impacto: 'impact', bold: 'impact', viral: 'impact', shock: 'impact',
  newsroom: 'newsroom', noticias: 'newsroom', news: 'newsroom', informativo: 'newsroom',
  periodismo: 'newsroom', actualidad: 'newsroom', redaccion: 'newsroom', 'redacción': 'newsroom',
  sport: 'sport', sports: 'sport', deporte: 'sport', deportes: 'sport', futbol: 'sport',
  'fútbol': 'sport', fitness: 'sport', gym: 'sport',
  vidrush: 'constructum', constructum: 'constructum', construccion: 'constructum', construcción: 'constructum',
};
const themeOf = (e: MotionEvent): Theme => {
  const raw = String((e && (e as any).theme) || '').toLowerCase().trim();
  const key = THEME_ALIAS[raw] || raw;
  const base = THEMES[key] || THEMES.documentary;
  // Tipografía CONFIGURABLE por canal: si el evento trae font, sobreescribe la del tema
  // (branding). Así todos los componentes (usan th.font) cambian de golpe.
  const f = String((e && (e as any).font) || '').trim();
  const t = f ? {...base, font: f} : base;
  // Cifras SIEMPRE en BebasNeue por defecto (contraste con el título → look editorial, no IA);
  // títulos con la fuente display del tema. Un canal puede fijar fontNum/fontDisplay a medida.
  // Cuerpo/subtítulos: si el título es una DISPLAY pesada (Anton/Archivo/Bebas), el subtítulo
  // usa una compañera más limpia (Oswald) → jerarquía tipográfica real. Si el tema ya es serif
  // (Playfair) o define fontBody, se respeta. Da las "varias tipografías que salgan bien".
  const fontBody = t.fontBody || (/Anton|Archivo|Bebas/i.test(t.font) ? "'Oswald', system-ui, sans-serif" : t.font);
  return {
    ...t,
    fontNum: t.fontNum || "'BebasNeue', 'Oswald', 'Arial Narrow', sans-serif",
    fontDisplay: t.fontDisplay || t.font,
    fontBody,
    // fontLabel = compañera CONDENSADA limpia para lower-thirds / kickers / bullets de specs
    // (por defecto = cuerpo). Da el contraste que pidió el usuario: el lower-third se lee en OTRA
    // fuente que los titulares de sección → un mismo vídeo usa 3-4 tipografías curadas (no solo Anton).
    fontLabel: t.fontLabel || fontBody,
  };
};
const GOLD = '#c9a86a';
const INK = 'rgba(8, 11, 16, 0.84)';

const PAD = 70; // margen seguro desde los bordes

// Semilla estable por evento → variación (un editor humano NO entra todo idéntico).
const seedOf = (event: MotionEvent): number => {
  const s = String(event.id || event.title || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

// Animación de entrada/salida NATURAL estilo editor humano (After Effects), no "IA":
//  • easing profesional (out-quint) en vez de spring uniforme → entrada con carácter.
//  • VARIACIÓN por evento: la dirección (sube / desde-izq / escala) y el tiempo de entrada
//    cambian según el id → no todos los overlays hacen el mismo slide-up.
//  • DERIVA sutil durante el hold (parallax lento) → el overlay respira, no queda congelado.
// Devuelve {opacity,y,x,scale,intro,wipe,drift}. Retro-compatible: y/opacity/intro siguen igual;
// x/scale/wipe/drift son EXTRA para que cada plantilla los use (slide lateral, máscara, parallax).
const timing = (event: MotionEvent, frame: number, fps: number) => {
  const end = event.duration * fps;
  const local = frame;
  const seed = seedOf(event);
  const dir = seed % 3;                                   // 0=sube · 1=desde-izq · 2=escala
  const inN = Math.max(9, Math.round(fps * (0.48 + (seed % 8) / 44)));  // ~0.48–0.66s, variable
  const introRaw = interpolate(local, [0, inN], [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1)});
  const fadeOut = Math.max(14, Math.round(fps * 0.45));
  const out = interpolate(local, [end - fadeOut, end], [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic)});
  const opacity = local < 0 || local > end ? 0 : Math.min(introRaw, out);
  const drift = Math.sin((local / fps) * 0.55 + ((seed % 100) / 100) * Math.PI) * 2.2;  // parallax lento
  const y = interpolate(introRaw, [0, 1], [dir === 0 ? 30 : 12, 0]) + drift * 0.35;
  const x = interpolate(introRaw, [0, 1], [dir === 1 ? -46 : 0, 0]);
  const scale = interpolate(introRaw, [0, 1], [dir === 2 ? 0.9 : 1, 1]);
  return {opacity, y, x, scale, intro: introRaw, wipe: introRaw, drift};
};

const clean = (value?: string) => String(value || '').replace(/\s+/g, ' ').trim();

const shortCopy = (value?: string, maxWords = 9, maxChars = 64) => {
  const text = clean(value);
  if (!text) return '';
  const parts = text.split(' ');
  let base = parts.slice(0, maxWords).join(' ');
  if (base.length > maxChars) base = base.slice(0, maxChars - 1).trim();
  return base.length < text.length ? `${base}…` : base;
};

const stripLeadingRank = (value: string) =>
  clean(value).replace(/^(?:#|top\s+|n(?:u|ú)mero\s+)?\d{1,2}\s*[-.:]?\s*/i, '').trim();

const extractRank = (event: MotionEvent): number | undefined => {
  if (event.rank && event.rank > 0) return event.rank;
  const m = clean(event.title).match(/^(?:#|top\s+|n(?:u|ú)mero\s+)?(\d{1,2})(?:\s|[-.:]|$)/i);
  return m ? Number(m[1]) : undefined;
};

// Extrae una CIFRA con su unidad de un texto: "13°C", "1,8 metros", "70%", "300".
const pickStat = (event: MotionEvent): {num: string; label: string} | null => {
  const text = `${clean(event.title)} ${clean(event.subtitle)}`;
  const m = text.match(/(\d[\d.,]*)\s?(°\s?[cf]|%|[$€£]|[a-z]{1,3}\b)?/i);
  if (!m) return null;
  const num = (m[1] + (m[2] ? ' ' + m[2].replace(/\s+/g, '') : '')).trim();
  const label = shortCopy(event.kicker || stripLeadingRank(event.title), 5, 28).toUpperCase();
  return {num, label};
};

// Extrae el "número/fecha protagonista" de un título para el BigStat centrado.
// Devuelve {value, isNumeric, target}. Si el título es una fecha ("1940") o una cifra
// ("20.000", "70%"), value es ese token; isNumeric/target sirven para el count-up.
const pickBig = (event: MotionEvent): {value: string; isNumeric: boolean; target: number; suffix: string} => {
  const raw = clean(event.title);
  // FECHA COMPLETA ("6 de junio de 1944"): se muestra ENTERA y elegante, sin count-up
  // (si no, contaría solo el "6"). El usuario prefiere la fecha entera al año suelto.
  if (/\d/.test(raw) && /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(raw)) {
    return {value: shortCopy(raw, 6, 26), isNumeric: false, target: 0, suffix: ''};
  }
  const m = raw.match(/(\d[\d.,]*)\s?(°\s?[cf]|%|[$€£+]|m|km|kg|bn|mil|millones|k|años|años|years)?/i);
  if (m) {
    const token = m[1];
    const suffix = (m[2] || '').replace(/\s+/g, '');
    const digits = token.replace(/[.,](?=\d{3}\b)/g, ''); // 20.000 → 20000 (separador de miles)
    const target = Number(digits.replace(',', '.'));
    const isNumeric = Number.isFinite(target);
    return {value: token, isNumeric, target: isNumeric ? target : 0, suffix};
  }
  // Sin dígitos: muestra el título tal cual (p.ej. una palabra/fecha en letras), sin count-up.
  return {value: shortCopy(raw, 4, 18), isNumeric: false, target: 0, suffix: ''};
};

// Formatea un número con separador de miles (punto, estilo ES). 20000 → "20.000".
// ⚠ BUG 2026-07-17: hacía Math.round() SIEMPRE → una cifra con decimal se destrozaba en el
// count-up ("1.5 km" salía "2KM", "2,5 millones" → "3"). Ahora respeta los decimales del
// número ORIGINAL: entero → "20.000" (igual que antes); con decimal → "1,5" (máx. 2).
const decimalsOf = (n: number): number => {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(2, s.length - i - 1);
};
// El LOCALE lo trae el evento (idioma del vídeo, sellado por remotion_graphics). Antes estaba
// fijo a 'es-ES' → un vídeo en inglés mostraba "1,5KM" en vez de "1.5KM".
const localeOf = (e: MotionEvent): string => String((e as any).locale || '').trim() || 'es-ES';
const fmtNum = (n: number, decimals = 0, locale = 'es-ES'): string =>
  n.toLocaleString(locale, {minimumFractionDigits: decimals, maximumFractionDigits: decimals});

// Valores para la CHART de barras. Usa event.items si traen "Etiqueta 42" / "Etiqueta: 42%";
// si no hay valores, genera 3-4 barras crecientes de ejemplo con etiquetas del título/items.
const chartBars = (event: MotionEvent): {label: string; value: number; display: string}[] => {
  const parsed: {label: string; value: number; display: string}[] = [];
  for (const rawItem of event.items || []) {
    const it = clean(rawItem);
    if (!it) continue;
    const m = it.match(/^(.*?)[\s:–-]*?(\d[\d.,]*)\s*(%|[a-z]{1,3})?\s*$/i);
    if (m && m[2]) {
      const label = shortCopy(m[1], 3, 16) || it;
      const num = Number(m[2].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
      if (Number.isFinite(num)) {
        parsed.push({label, value: num, display: m[2] + (m[3] || '')});
        continue;
      }
    }
    parsed.push({label: shortCopy(it, 3, 16), value: NaN, display: ''});
  }
  const withNums = parsed.filter((p) => Number.isFinite(p.value));
  if (withNums.length >= 2) return withNums.slice(0, 5);
  // Sin valores reales: barras crecientes de ejemplo (curva suave), etiquetas si las hay.
  const labels = parsed.length
    ? parsed.map((p) => p.label)
    : [shortCopy(event.title, 2, 12) || 'A', 'B', 'C', 'D'];
  const n = Math.min(4, Math.max(3, labels.length));
  const sample = [38, 56, 78, 100];
  return Array.from({length: n}, (_, i) => ({
    label: labels[i] || String.fromCharCode(65 + i),
    value: sample[i] ?? 100,
    display: '',
  }));
};

// Barras REALES y SOLO reales (2026-07-17, el usuario quiere "una gráfica, algo que se vea" pero
// NUNCA con datos inventados): igual que chartBars pero SIN el fallback de barras de ejemplo.
// [] o 1 barra = el contenido no da para una gráfica → renderEvent NO pinta <Chart> y el momento
// cae al overlay normal. chartBars (con fallback) se mantiene intacto para VoxChart.
const chartBarsReal = (event: MotionEvent): {label: string; value: number; display: string}[] => {
  const out: {label: string; value: number; display: string}[] = [];
  for (const rawItem of event.items || []) {
    const it = clean(rawItem);
    if (!it) continue;
    const m = it.match(/^(.*?)[\s:–-]*?(\d[\d.,]*)\s*(%|[a-z]{1,3})?\s*$/i);
    if (!m || !m[2]) continue;
    const num = Number(m[2].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
    if (!Number.isFinite(num)) continue;
    const label = shortCopy(m[1], 3, 16);
    if (!label) continue;                         // una cifra suelta no es una barra
    out.push({label, value: num, display: m[2] + (m[3] || '')});
  }
  return out.slice(0, 5);
};

// Filtra "items" que son ruido interno del pipeline; deja solo bullets reales.
const JUNK_ITEMS = new Set([
  'guion', 'guión', 'voz', 'srt', 'assets', 'montaje', 'clip', 'clips', 'imagen',
  'imagenes', 'imágenes', 'video', 'vídeo', 'stock', 'paso', 'pasos', 'fase', 'fases',
]);
const realItems = (event: MotionEvent): string[] =>
  (event.items || [])
    .map((s) => clean(s))
    .filter((s) => s.length > 2 && !JUNK_ITEMS.has(s.toLowerCase()))
    .slice(0, 4);

// ── 1) LOWER THIRD — etiqueta/tema. Abajo-izquierda. El caballo de batalla. ──
const LowerThird: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const title = shortCopy(event.title, 8, 52);
  const sub = shortCopy(event.subtitle, 9, 64);
  const up = th.upper ? 'uppercase' as const : 'none' as const;
  // ── ESTILO BEYOND MILITARY (2026-07-14, referente @beyondmilitary del usuario): rótulo con
  // RESALTADOR AMARILLO (tipo marcador) detrás de texto OSCURO condensado — tight, funcional, la
  // firma de BM ("Mobile Fire Group"). NO cajas/paneles/gradientes ni viñetas (eso se veía de IA).
  if (th.badge) {
    const hi = accent;
    return (
      <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.font}}>
        <div style={{position: 'absolute', left: PAD, bottom: PAD, maxWidth: '74%', transform: `translateY(${t.y}px)`, lineHeight: 1.32}}>
          {event.kicker ? (
            <div style={{marginBottom: 8}}>
              <span style={{background: '#0b0b0b', color: hi, fontSize: 13, fontWeight: 900, letterSpacing: 2.5, textTransform: 'uppercase', padding: '3px 9px', WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone'} as React.CSSProperties}>
                {shortCopy(event.kicker, 4, 24)}
              </span>
            </div>
          ) : null}
          <span style={{background: hi, color: '#0b0b0b', fontSize: 42, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.3, padding: '3px 11px', WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone'} as React.CSSProperties}>
            {title}
          </span>
          {sub ? <div style={{fontSize: 20, color: '#fff', fontWeight: 600, marginTop: 11, maxWidth: 560, textShadow: '0 2px 10px rgba(0,0,0,0.96)'}}>{sub}</div> : null}
        </div>
      </AbsoluteFill>
    );
  }
  return (
    // Lower-third = fuente ETIQUETA (fontLabel): se lee en OTRA fuente que los titulares de
    // sección (fontDisplay) → el vídeo deja de ser "solo Anton" (bug reportado por el usuario).
    <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.fontLabel}}>
      {/* Scrim suave en la esquina para legibilidad, SIN “card” (look editorial, no plantilla). */}
      <div style={{position: 'absolute', left: 0, bottom: 0, width: '70%', height: '34%', background: 'linear-gradient(45deg, rgba(0,0,0,0.52), rgba(0,0,0,0) 70%)'}} />
      <div style={{position: 'absolute', left: PAD, bottom: PAD, maxWidth: '64%', transform: `translateY(${t.y}px)`}}>
        {event.kicker ? (
          <div style={{color: accent, fontSize: 15, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 9, textShadow: '0 2px 10px rgba(0,0,0,0.9)'}}>
            {shortCopy(event.kicker, 4, 24)}
          </div>
        ) : null}
        <div style={{fontSize: 40, fontWeight: 800, lineHeight: 1.05, color: th.over, textTransform: up, letterSpacing: 0.2, textShadow: '0 4px 22px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.95)'}}>{title}</div>
        <div style={{width: 56, height: 3, background: accent, marginTop: 12}} />
        {sub ? <div style={{fontFamily: th.fontBody, fontSize: 20, color: th.over, opacity: 0.88, marginTop: 10, fontWeight: 500, letterSpacing: 0.3, maxWidth: 560, textShadow: '0 2px 12px rgba(0,0,0,0.95)'}}>{sub}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 2) STAT — cifra grande dorada + etiqueta. Abajo-izquierda. ──
const Stat: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const s = pickStat(event);
  const num = s?.num || clean(event.title);
  const label = s?.label || shortCopy(event.kicker || event.subtitle, 6, 34).toUpperCase();
  // ── TÁCTICO (Beyond Military): DATA BADGE — caja de acento sólido, texto oscuro, esquinas
  // vivas, cifra grande arriba + etiqueta/unidad debajo. Abajo-izquierda, sin scrim (la caja
  // ya da contraste). Entra rápido (translateY corto).
  if (th.badge) {
    const ink = th.badgeInk || '#0b0b0b';
    // Unidad DELANTE del número ("Mach 3.5", "Clase Kilo 636"): pickStat solo coge el
    // número → usar el título entero si es corto (conserva la unidad, estilo BM).
    const rawT = clean(event.title);
    const badgeNum = (/^[A-Za-zÀ-ÿ$€£]{1,7}[\s-]?\d/.test(rawT) && rawT.length <= 16) ? rawT : num;
    return (
      <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.font}}>
        <div style={{position: 'absolute', left: PAD, bottom: PAD, transform: `translateY(${t.y * 0.5}px)`,
          background: accent, padding: '14px 22px 16px', maxWidth: '70%',
          boxShadow: '0 10px 30px rgba(0,0,0,0.55)', borderLeft: `8px solid ${ink}`}}>
          <div style={{fontSize: 92, fontWeight: 900, lineHeight: 0.86, color: ink, letterSpacing: -1, textTransform: 'uppercase'}}>{badgeNum}</div>
          {label ? (
            <div style={{fontSize: 24, fontWeight: 900, color: ink, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 6, maxWidth: 520, lineHeight: 1.05}}>{label}</div>
          ) : null}
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.font}}>
      <div style={{position: 'absolute', left: 0, bottom: 0, width: '60%', height: '46%', background: 'linear-gradient(45deg, rgba(0,0,0,0.50), rgba(0,0,0,0) 72%)'}} />
      <div style={{position: 'absolute', left: PAD, bottom: PAD, display: 'flex', alignItems: 'flex-end', gap: 20, transform: `translateY(${t.y}px)`, maxWidth: '74%'}}>
        <div style={{fontFamily: th.fontNum, fontSize: 140, fontWeight: 400, lineHeight: 0.80, color: accent, letterSpacing: 1, fontVariantNumeric: 'tabular-nums', textShadow: '0 14px 44px rgba(0,0,0,0.6)'}}>{num}</div>
        {label ? (
          <div style={{paddingBottom: 16}}>
            <div style={{width: 40, height: 4, background: accent, marginBottom: 9}} />
            <div style={{fontFamily: th.fontLabel, fontSize: 23, fontWeight: 700, color: th.over, letterSpacing: 1, textTransform: 'uppercase', maxWidth: 380, lineHeight: 1.12, textShadow: '0 4px 18px rgba(0,0,0,0.85)'}}>{label}</div>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 5b) NARRATIVE TEXT — frase destacada con palabras clave en dorado ──────────
// Estilo Firearms Vault / Eli Yoder: texto grande sobre metraje con palabras
// clave resaltadas en boxes dorados. Para afirmaciones impactantes y citas.
// El title lleva la frase completa; items[] son las palabras/frases a destacar.
const NarrativeText: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const text = clean(event.title);
  const highlights = (event.items || []).map((s: string) => clean(s)).filter(Boolean);
  // Split text into segments: highlighted vs normal
  const segments: {text: string; highlighted: boolean}[] = [];
  if (highlights.length > 0) {
    let remaining = text;
    while (remaining.length > 0) {
      let earliest = -1;
      let earliestIdx = -1;
      for (let i = 0; i < highlights.length; i++) {
        const pos = remaining.toLowerCase().indexOf(highlights[i].toLowerCase());
        if (pos >= 0 && (earliest < 0 || pos < earliest)) {
          earliest = pos;
          earliestIdx = i;
        }
      }
      if (earliest < 0) {
        segments.push({text: remaining, highlighted: false});
        break;
      }
      if (earliest > 0) segments.push({text: remaining.slice(0, earliest), highlighted: false});
      segments.push({text: remaining.slice(earliest, earliest + highlights[earliestIdx].length), highlighted: true});
      remaining = remaining.slice(earliest + highlights[earliestIdx].length);
    }
  } else {
    segments.push({text, highlighted: false});
  }
  // Word-by-word reveal
  const totalWords = text.split(/\s+/).length;
  // La frase se ESCRIBE AL RITMO DE LA VOZ: remotion_graphics estima cuánto tarda en decirse
  // (revealSeconds, por posición de la frase en el SRT) y el evento arranca cuando empieza a
  // decirse. Sin estimación: reveal ágil (~1.2 s). Pedido del usuario 2026-09-05: "mientras se
  // dice, se vaya escribiendo".
  const _rs = Number((event as any).revealSeconds || 0);
  const revealDuration = _rs > 0
    ? Math.max(fps * 0.5, Math.min(fps * 4.5, _rs * fps))
    : Math.max(fps * 0.5, Math.min(fps * 1.2, totalWords * 2));
  const wordsRevealed = Math.floor(interpolate(frame, [0, revealDuration], [0, totalWords],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)}));
  let wordCount = 0;
  // Referencia (American Secrets: "They saw humiliation. She wasn't hiding."): frase grande en
  // caja/tipo del tema (serif en documental, minúsculas), palabras clave sobre RESALTADOR de
  // acento con texto oscuro. Scrim moderado: el metraje sigue viéndose.
  const upNT = th.upper ? 'uppercase' as const : 'none' as const;
  return (
    <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.font}}>
      {/* Dark overlay for legibility */}
      <AbsoluteFill style={{background: 'rgba(0,0,0,0.44)'}} />
      <div style={{
        position: 'absolute', left: PAD + 20, right: PAD + 20,
        top: '50%', transform: `translateY(-50%) translateY(${t.y * 0.3}px)`,
        maxWidth: 1180,
      }}>
        <div style={{
          fontSize: 70, fontWeight: 800, lineHeight: 1.24, color: 'white',
          letterSpacing: th.upper ? 0.5 : 0, textTransform: upNT,
          fontFamily: th.fontDisplay || th.font,
          textShadow: '0 4px 20px rgba(0,0,0,0.7)',
        }}>
          {segments.map((seg, si) => {
            const segWords = seg.text.split(/(\s+)/);
            return segWords.map((word, wi) => {
              // Los espacios NO cuentan como palabra: antes sumaban al contador y, como
              // totalWords solo cuenta palabras, la frase se quedaba a medio escribir.
              if (!word) return null;
              if (/^\s+$/.test(word)) {
                return <span key={`${si}-${wi}`}>{word}</span>;
              }
              wordCount++;
              const visible = wordCount <= wordsRevealed;
              const wordOpacity = visible ? 1 : 0;
              if (seg.highlighted) {
                return (
                  <span key={`${si}-${wi}`} style={{
                    opacity: wordOpacity, transition: 'opacity 0.15s',
                    background: accent, color: '#0a0a0a',
                    padding: '2px 8px 4px', margin: '0 2px',
                    display: 'inline', boxDecorationBreak: 'clone' as any,
                  }}>{word}</span>
                );
              }
              return <span key={`${si}-${wi}`} style={{opacity: wordOpacity, transition: 'opacity 0.15s'}}>{word}</span>;
            });
          })}
        </div>
        {event.subtitle ? (
          <div style={{
            fontSize: 20, fontWeight: 600, color: accent,
            letterSpacing: 2, textTransform: 'uppercase', marginTop: 18,
            fontFamily: th.fontLabel, opacity: t.intro,
          }}>{shortCopy(event.subtitle, 8, 60)}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 6) BIG CENTER STAT/DATE — número o FECHA GRANDE y CENTRADO en pantalla. ──
// Para 1-2 momentos clave (sobre todo la intro): una fecha/cifra fuerte que enganche.
// Reveal LIMPIO (scale-up + fade) y, si es un número, count-up suave. NO máquina de
// escribir. Usa la tipografía y el acento del TEMA del nicho (themeOf).
const BigStat: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const big = pickBig(event);
  const sub = shortCopy(event.subtitle, 9, 70);
  const up = th.upper ? 'uppercase' as const : 'none' as const;

  // Reveal: escala 0.86→1 + fade en ~18 frames (spring suave de timing).
  const reveal = interpolate(t.intro, [0, 1], [0.86, 1], {extrapolateRight: 'clamp'});
  // Count-up RÁPIDO (~0.6s) y luego el número final AGUANTA el resto de la escena: el
  // usuario pidió que la cifra grande no desaparezca justo tras contar. Easing out = "aterriza".
  const countP = interpolate(frame, [0, Math.round(fps * 0.6)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const shown = big.isNumeric
    ? fmtNum(big.target * countP, decimalsOf(big.target), localeOf(event)) + (big.suffix || '')
    : big.value;
  // PICTOGRAMAS (variedad, pedido del usuario): si la cifra habla de personas/barcos/aviones,
  // una fila de iconos aparece escalonada bajo el número — así no todo es el mismo count-up.
  const ctx = `${clean(event.title)} ${clean(event.subtitle)}`.toLowerCase();
  const picto = /\b(persona|personas|gente|soldado|soldados|hombres|mujeres|tropas|paracaidistas|habitantes|muertos|bajas|v[íi]ctimas|people|men|troops)\b/.test(ctx) ? 'person'
    : /\b(barco|barcos|buque|buques|flota|nav[íi]o|nav[íi]os|ships?|boats?)\b/.test(ctx) ? 'ship'
    : /\b(avi[óo]n|aviones|ca[zc]as|bombarderos|planes?|aircraft)\b/.test(ctx) ? 'plane' : '';
  const nIcons = big.isNumeric && picto ? 10 : 0;
  const PICTO_PATHS: Record<string, string> = {
    person: 'M12 4a3 3 0 110 6 3 3 0 010-6zm-5 16v-5a5 5 0 0110 0v5h-3v-4h-4v4z',
    ship: 'M3 15l2-6h5V5h4v4h5l2 6-9 3zM2 18h20l-2 3H4z',
    plane: 'M2 13l8-2 3-8 2 1-1 7 7 2v2l-7 1-2 6h-2l1-7-9 0z',
  };

  return (
    <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.fontDisplay, justifyContent: 'center', alignItems: 'center'}}>
      {/* Fondo oscuro opaco al estilo OverBuilt: el dato "respira" sin b-roll compitiendo. */}
      <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(12,15,20,0.93) 0%, rgba(8,10,14,0.97) 100%)'}} />
      <div style={{textAlign: 'center', transform: `scale(${reveal})`, maxWidth: '88%'}}>
        <div style={{fontFamily: big.isNumeric ? th.fontNum : th.fontDisplay, fontSize: 250, fontWeight: 400, lineHeight: 0.86, color: accent, letterSpacing: 2, textShadow: '0 18px 60px rgba(0,0,0,0.65)', fontVariantNumeric: 'tabular-nums'}}>
          {shown}
        </div>
        {nIcons > 0 ? (
          <div style={{display: 'flex', justifyContent: 'center', gap: 10, marginTop: 20}}>
            {Array.from({length: nIcons}, (_, k) => (
              <svg key={k} width="30" height="30" viewBox="0 0 24 24"
                style={{opacity: countP * nIcons > k ? 0.95 : 0.18, transition: 'none'}}>
                <path d={PICTO_PATHS[picto]} fill={accent} />
              </svg>
            ))}
          </div>
        ) : null}
        <div style={{width: 120, height: 5, background: accent, margin: '26px auto 0'}} />
        {sub ? (
          <div style={{fontFamily: th.fontBody, fontSize: 31, fontWeight: 500, color: th.over, marginTop: 22, textTransform: up, letterSpacing: th.upper ? 1 : 0.3, lineHeight: 1.25, textShadow: '0 4px 20px rgba(0,0,0,0.9)'}}>
            {sub}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ── 7) CHART — gráfica de BARRAS (2-5) animada con el acento del tema. ──
// Para frases de cantidad/crecimiento/comparación numérica. Las barras crecen de forma
// escalonada. Ocupa ~centro-bajo sin tapar todo. Usa color de acento del nicho (themeOf).
// ⚠ DATOS REALES SIEMPRE (chartBarsReal): las cantidades salen del guion (_chart_window en
// remotion_graphics.py). Si no hay ≥2 barras reales no se pinta nada — cero invención.
const Chart: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const bars = chartBarsReal(event);
  const maxVal = Math.max(...bars.map((b) => b.value), 1);
  if (bars.length < 2) return null;               // salvaguarda: nunca barras de ejemplo
  const title = shortCopy(event.title, 7, 44);
  // La UNIDAD real ("millones de dólares", "toneladas") viaja en el subtítulo: sin ella las
  // barras serían números sin significado. Solo se pinta si el guion la dijo.
  const unit = shortCopy(event.subtitle, 6, 40);
  const up = th.upper ? 'uppercase' as const : 'none' as const;
  // GRÁFICA = overlay SOBRE el metraje real (abajo-izquierda), NUNCA sobre fondo de color.
  // (El que va a pantalla completa es el MAPA, no la gráfica.) Scrim suave para legibilidad.
  const onRight = event.side === 'right';
  const CHART_H = 300;
  const BAR_W = bars.length >= 5 ? 78 : 92;
  const GAP = 28;
  const width = bars.length * BAR_W + (bars.length - 1) * GAP;

  return (
    <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.font}}>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: '64%', background: 'linear-gradient(0deg, rgba(0,0,0,0.62), rgba(0,0,0,0))'}} />
      <div style={{position: 'absolute', bottom: PAD, [onRight ? 'right' : 'left']: PAD, transform: `translateY(${t.y}px)`, maxWidth: '72%'}}>
        <div style={{fontFamily: th.fontDisplay, fontSize: 30, fontWeight: 800, color: th.over, textTransform: up, letterSpacing: th.upper ? 1.2 : 0.2, marginBottom: 6, textShadow: '0 4px 18px rgba(0,0,0,0.95)'}}>
          {title}
        </div>
        {unit ? (
          <div style={{fontFamily: th.fontLabel, fontSize: 19, fontWeight: 600, color: th.over, opacity: 0.78, letterSpacing: 0.4, marginBottom: 6, textShadow: '0 3px 14px rgba(0,0,0,0.95)'}}>
            {unit}
          </div>
        ) : null}
        <div style={{width: 64, height: 4, background: accent, marginBottom: 20}} />
        <div style={{display: 'flex', alignItems: 'flex-end', gap: GAP, height: CHART_H, width}}>
          {bars.map((b, i) => {
            // Crecimiento escalonado con easing (más "After Effects" que lineal).
            const grow = interpolate(t.intro, [0.12 + i * 0.12, 0.64 + i * 0.12], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
            });
            const h = (b.value / maxVal) * (CHART_H - 46) * grow;
            const isMax = b.value >= maxVal - 1e-6;           // barra protagonista
            // Valor que CUENTA al crecer y se fija en el display real al terminar.
            const valLabel = grow > 0.985 ? (b.display || fmtNum(b.value, decimalsOf(b.value), localeOf(event)))
              : fmtNum(b.value * grow, decimalsOf(b.value), localeOf(event));
            return (
              <div key={i} style={{width: BAR_W, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%'}}>
                <div style={{fontFamily: th.fontNum, fontSize: isMax ? 34 : 27, fontWeight: 400, color: isMax ? '#ffffff' : accent, marginBottom: 8, opacity: grow, letterSpacing: 0.5, fontVariantNumeric: 'tabular-nums', textShadow: '0 2px 10px rgba(0,0,0,0.95)'}}>
                  {valLabel}
                </div>
                <div
                  style={{
                    width: '100%',
                    height: Math.max(2, h),
                    background: `linear-gradient(180deg, ${accent}, ${accent}aa)`,
                    borderRadius: '5px 5px 0 0',
                    borderTop: `3px solid ${isMax ? '#ffffff' : accent}`,
                    boxShadow: isMax ? `0 0 32px ${accent}` : `0 0 14px ${accent}44`,
                    opacity: isMax ? 1 : 0.8,
                  }}
                />
                <div style={{fontSize: 17, fontWeight: isMax ? 800 : 600, color: th.over, marginTop: 10, textAlign: 'center', maxWidth: BAR_W + 14, lineHeight: 1.1, textShadow: '0 2px 10px rgba(0,0,0,0.95)', opacity: isMax ? 1 : 0.82}}>
                  {b.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 7b) LINE CHART — SERIE TEMPORAL que SE DIBUJA sobre el metraje. ──
// Hermana de <Chart>: MISMO gate honesto (chartBarsReal → cantidades REALES del guion, sacadas
// por _chart_window en remotion_graphics.py) y MISMA cabecera; cambia solo la FORMA, y la forma
// la decide el DATO, no el planner: etiquetas = AÑOS seguidos ⇒ tendencia ⇒ línea
// (event.chartKind='line', sellado en Python y ya ordenado cronológicamente); categorías /
// entidades / porcentajes ⇒ barras de siempre.
// Es el gráfico de la referencia Vox ("INFLACIÓN ANUAL" con su callout), pero como OVERLAY sobre
// el metraje real y con la tipografía/acento del TEMA — la tarjeta de papel a pantalla completa
// sigue siendo exclusiva del modo Vox (regla: la gráfica es overlay, el MAPA es fullscreen).
// Necesita ≥3 puntos: con 2 no hay tendencia que leer → renderEvent cae a barras.
const LineChart: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const pts = chartBarsReal(event);
  if (pts.length < 3) return null;                 // salvaguarda: jamás una línea inventada
  const title = shortCopy(event.title, 7, 44);
  const unit = shortCopy(event.subtitle, 6, 40);
  const up = th.upper ? ('uppercase' as const) : ('none' as const);
  const onRight = event.side === 'right';
  const W = 660, H = 250, padL = 16, padR = 70, padT = 44, padB = 34;
  const vals = pts.map((p) => p.value);
  const maxV = Math.max(...vals);
  const minV = Math.min(...vals);
  const spanV = Math.max(1e-6, maxV - minV);
  // Márgenes verticales: la línea no queda pegada a los bordes de la caja.
  const lo = minV - spanV * 0.20;
  const hi = maxV + spanV * 0.18;
  const px = (i: number) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const py = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const xy = pts.map((p, i) => [px(i), py(p.value)] as [number, number]);
  // Longitud REAL de la polilínea → el trazo se dibuja a velocidad constante, no a saltos.
  let len = 0;
  for (let i = 1; i < xy.length; i++) {
    len += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  }
  // Dibujo DELIBERADO (~1.5s): una tendencia hay que leerla, no es un rótulo que entra y sale.
  const draw = interpolate(frame, [Math.round(fps * 0.3), Math.round(fps * 1.8)], [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const linePts = xy.map(([x, y]) => `${x},${y}`).join(' ');
  const areaPts = `${xy[0][0]},${H - padB} ${linePts} ${xy[xy.length - 1][0]},${H - padB}`;
  const clipId = `lc_${String(event.id || 'x').replace(/[^a-zA-Z0-9_]/g, '')}`;
  // Punto PROTAGONISTA = el MÁXIMO real de la serie, con su cifra tal cual la dice el guion.
  const maxI = vals.reduce((b, v, i) => (v > vals[b] ? i : b), 0);
  const pop = interpolate(frame, [Math.round(fps * 1.85), Math.round(fps * 2.3)], [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const peak = pts[maxI];
  const peakTxt = peak.display || fmtNum(peak.value, decimalsOf(peak.value), localeOf(event));

  return (
    <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.font}}>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%', background: 'linear-gradient(0deg, rgba(0,0,0,0.62), rgba(0,0,0,0))'}} />
      <div style={{position: 'absolute', bottom: PAD, [onRight ? 'right' : 'left']: PAD, transform: `translateY(${t.y}px)`, maxWidth: '74%'}}>
        <div style={{fontFamily: th.fontDisplay, fontSize: 30, fontWeight: 800, color: th.over, textTransform: up, letterSpacing: th.upper ? 1.2 : 0.2, marginBottom: 6, textShadow: '0 4px 18px rgba(0,0,0,0.95)'}}>
          {title}
        </div>
        {unit ? (
          <div style={{fontFamily: th.fontLabel, fontSize: 19, fontWeight: 600, color: th.over, opacity: 0.78, letterSpacing: 0.4, marginBottom: 6, textShadow: '0 3px 14px rgba(0,0,0,0.95)'}}>
            {unit}
          </div>
        ) : null}
        <div style={{width: 64, height: 4, background: accent, marginBottom: 14}} />
        {/* El callout se posiciona respecto a ESTE contenedor (no al bloque de cabecera): así
            sigue clavado en el pico aunque el titular ocupe una o dos líneas. */}
        <div style={{position: 'relative', width: W, height: H}}>
        <svg width={W} height={H} style={{display: 'block', overflow: 'visible'}}>
          <defs>
            <clipPath id={clipId}>
              {/* revela area+linea a la vez, de izquierda a derecha */}
              <rect x={0} y={0} width={padL + draw * (W - padL - padR) + 2} height={H} />
            </clipPath>
            <linearGradient id={`${clipId}_g`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity={0.34} />
              <stop offset="100%" stopColor={accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* rejilla tenue: 3 lineas de referencia, sin numeros inventados en el eje */}
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1={padL} x2={W - padR} y1={py(lo + (hi - lo) * f)} y2={py(lo + (hi - lo) * f)}
              stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
          ))}
          <g clipPath={`url(#${clipId})`}>
            <polygon points={areaPts} fill={`url(#${clipId}_g)`} />
          </g>
          <polyline points={linePts} fill="none" stroke={accent} strokeWidth={5}
            strokeLinejoin="round" strokeLinecap="round"
            strokeDasharray={len} strokeDashoffset={len * (1 - draw)}
            style={{filter: `drop-shadow(0 3px 10px rgba(0,0,0,0.85))`}} />
          {xy.map(([x, y], i) => {
            const on = draw >= i / (pts.length - 1) - 0.001;
            if (!on) return null;
            const isMax = i === maxI;
            return (
              <circle key={i} cx={x} cy={y} r={isMax ? 9 : 6}
                fill={isMax ? '#ffffff' : th.panel} stroke={accent} strokeWidth={isMax ? 5 : 3} />
            );
          })}
          {/* etiquetas del eje X = las ETIQUETAS REALES (los años del guion) */}
          {xy.map(([x], i) => (
            <text key={i} x={x} y={H - padB + 26} textAnchor="middle"
              fontFamily={th.fontLabel} fontSize={18} fontWeight={600}
              fill={th.over} opacity={draw >= i / (pts.length - 1) - 0.001 ? 0.86 : 0}
              style={{textShadow: '0 2px 10px rgba(0,0,0,0.95)'}}>
              {shortCopy(pts[i].label, 1, 8)}
            </text>
          ))}
        </svg>
        {/* CALLOUT del pico (como el "+4,2% máximo" de la referencia) — cifra REAL del guion. */}
        <div
          style={{
            position: 'absolute',
            left: xy[maxI][0] + 18,
            top: xy[maxI][1] - 26,
            transform: `scale(${0.86 + pop * 0.14})`, transformOrigin: 'left center',
            opacity: pop,
            background: th.panel, border: `3px solid ${accent}`, borderRadius: 8,
            padding: '6px 12px', display: 'flex', alignItems: 'baseline', gap: 8,
            boxShadow: '0 10px 24px rgba(0,0,0,0.45)', whiteSpace: 'nowrap',
          }}
        >
          <span style={{fontFamily: th.fontNum, fontSize: 34, fontWeight: 400, color: th.panelText, letterSpacing: 0.5, fontVariantNumeric: 'tabular-nums'}}>
            {peakTxt}
          </span>
          <span style={{fontFamily: th.fontLabel, fontSize: 16, fontWeight: 700, color: accent, textTransform: up, letterSpacing: 0.6}}>
            {shortCopy(peak.label, 1, 8)}
          </span>
        </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 3) RANKING — "#N" grande + nombre. Abajo-izquierda (listicle). ──
const Ranking: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const rank = extractRank(event) || 1;
  const name = shortCopy(stripLeadingRank(event.title), 6, 38);
  const sub = shortCopy(event.subtitle, 8, 56);
  const up = th.upper ? 'uppercase' as const : 'none' as const;
  return (
    <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.font}}>
      <div style={{position: 'absolute', left: 0, bottom: 0, width: '64%', height: '44%', background: 'linear-gradient(45deg, rgba(0,0,0,0.50), rgba(0,0,0,0) 72%)'}} />
      <div style={{position: 'absolute', left: PAD, bottom: PAD, display: 'flex', alignItems: 'center', gap: 24, transform: `translateY(${t.y}px)`, maxWidth: '78%'}}>
        <div style={{fontFamily: th.fontNum, fontSize: 140, fontWeight: 400, lineHeight: 0.8, color: accent, letterSpacing: 1, textShadow: '0 14px 44px rgba(0,0,0,0.6)'}}>#{rank}</div>
        <div>
          <div style={{fontFamily: th.fontDisplay, fontSize: 48, fontWeight: 900, color: th.over, textTransform: up, letterSpacing: 0.4, lineHeight: 1.0, textShadow: '0 6px 22px rgba(0,0,0,0.8)'}}>{name}</div>
          <div style={{width: 66, height: 4, background: accent, margin: '11px 0'}} />
          {sub ? <div style={{fontFamily: th.fontBody, fontSize: 21, color: th.over, opacity: 0.86, fontWeight: 500, letterSpacing: 0.3, maxWidth: 520, textShadow: '0 3px 14px rgba(0,0,0,0.8)'}}>{sub}</div> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 4) SECTION TITLE — título grande + subrayado dorado. Zona baja. ──
const SectionTitle: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const title = shortCopy(event.title, 8, 46);
  const up = th.upper ? 'uppercase' as const : 'none' as const;
  return (
    <AbsoluteFill style={{opacity: t.opacity, justifyContent: 'flex-end', alignItems: 'flex-start', fontFamily: th.fontDisplay}}>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', background: 'linear-gradient(0deg, rgba(0,0,0,0.66), rgba(0,0,0,0))'}} />
      <div style={{position: 'absolute', left: PAD, bottom: PAD + 6, maxWidth: '80%', transform: `translateY(${t.y}px)`}}>
        {event.kicker ? <div style={{fontFamily: th.fontLabel, color: accent, fontSize: 18, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 11}}>{shortCopy(event.kicker, 5, 26)}</div> : null}
        <div style={{fontSize: 66, fontWeight: 900, color: th.over, lineHeight: 0.99, textTransform: up, letterSpacing: 0.3, textShadow: '0 8px 30px rgba(0,0,0,0.7)'}}>{title}</div>
        <div style={{width: 124, height: 5, background: accent, marginTop: 17}} />
      </div>
    </AbsoluteFill>
  );
};

// ── 5) SPEC PANEL — panel oscuro lateral con bullets reales (como el doc militar). ──
const SpecPanel: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const items = realItems(event);
  const title = shortCopy(event.title, 6, 34);
  // ── ESTILO BEYOND MILITARY (2026-07-14): SIN cajita redondeada con sombra/viñetas (se veía de
  // IA). Título en RESALTADOR amarillo + líneas limpias en blanco con un guion de acento, sobre
  // scrim suave abajo-izquierda. Editorial, no "panel de plantilla".
  return (
    <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.font}}>
      <div style={{position: 'absolute', left: 0, bottom: 0, width: '54%', height: '58%', background: 'linear-gradient(45deg, rgba(0,0,0,0.60), rgba(0,0,0,0) 74%)'}} />
      <div style={{position: 'absolute', left: PAD, bottom: PAD, maxWidth: '54%', transform: `translateY(${t.y}px)`}}>
        <span style={{background: accent, color: '#0b0b0b', fontSize: 34, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.3, padding: '3px 11px', lineHeight: 1.32, WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone'} as React.CSSProperties}>{title}</span>
        <div style={{marginTop: 16}}>
          {items.map((it, i) => {
            const p = interpolate(t.intro, [0.2 + i * 0.12, 0.5 + i * 0.12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
            return (
              <div key={i} style={{display: 'flex', alignItems: 'baseline', gap: 13, marginBottom: 11, opacity: p, transform: `translateX(${(1 - p) * 14}px)`}}>
                <span style={{width: 18, height: 3, background: accent, flexShrink: 0, transform: 'translateY(-5px)'}} />
                <span style={{fontFamily: th.fontLabel, fontSize: 24, color: '#fff', fontWeight: 600, lineHeight: 1.2, textShadow: '0 2px 10px rgba(0,0,0,0.96)'}}>{shortCopy(it, 7, 44)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── TRANSICIÓN — overlay corto en el corte (NO toca el montaje → no desincroniza audio).
// Barrido de luz diagonal + leve oscurecimiento (sutil, documental). ~70/30 cortes/transición.
const Transition: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const dur = Math.max(0.3, event.duration) * fps;
  const p = Math.min(1, Math.max(0, frame / dur));
  const x = interpolate(p, [0, 1], [-130, 130]);
  const dip = Math.sin(p * Math.PI); // 0→1→0
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <AbsoluteFill style={{background: '#04060a', opacity: dip * 0.30}} />
      <div style={{position: 'absolute', top: -40, bottom: -40, left: `${x}%`, width: '46%', transform: 'skewX(-12deg)', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.0), rgba(255,255,255,0.22), rgba(255,255,255,0.0), transparent)', filter: 'blur(7px)'}} />
    </AbsoluteFill>
  );
};

// ── FILM BURN — destello cálido tipo "fuga de luz" SOLO en cambios de sección grandes
// (no en cada corte). Sin línea que "pasa" (eso no cuadraba): solo un resplandor cálido
// que entra fuerte y se disuelve. mixBlendMode 'screen' = aditivo (look de película).
// Tinte = acento del nicho (crime→rojo, history→dorado…). No toca el montaje → no desincroniza.
const FilmBurn: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const dur = Math.max(0.3, event.duration) * fps;
  const p = Math.min(1, Math.max(0, frame / dur));
  const env = p < 0.22 ? p / 0.22 : Math.max(0, 1 - (p - 0.22) / 0.78); // golpe corto, pico ~0.13s
  const th = themeOf(event);
  const warm = th.accent || '#ffb060';
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {/* 1) dip uniforme cálido-oscuro breve (blend normal) — hace el corte VISIBLE sobre
            CUALQUIER metraje (claro u oscuro). Máx ~33% y solo ~0.15s → "beat" rápido, no un fundido. */}
      <AbsoluteFill style={{opacity: env * 0.33, background: '#0a0805'}} />
      {/* 2) viñeta oscura (refuerza el dip en los bordes) */}
      <AbsoluteFill style={{opacity: env * 0.42, background:
        'radial-gradient(135% 100% at 50% 50%, rgba(0,0,0,0) 24%, rgba(0,0,0,0.92) 100%)'}} />
      {/* 3) fuga de luz cálida aditiva (screen) — el "film burn" con el color del nicho */}
      <AbsoluteFill style={{mixBlendMode: 'screen', opacity: env, background:
        `radial-gradient(135% 95% at 84% 12%, ${warm} 0%, ${warm}66 24%, transparent 58%)`}} />
      <AbsoluteFill style={{mixBlendMode: 'screen', opacity: env * 0.6, background:
        'radial-gradient(115% 85% at 10% 92%, #ffdca8 0%, transparent 52%)'}} />
      {/* 4) destello blanco breve al pico */}
      <AbsoluteFill style={{mixBlendMode: 'screen', opacity: env * 0.22, background: '#ffffff'}} />
    </AbsoluteFill>
  );
};

// ── 8) MAP ROUTE — mapa táctico/estratégico con RUTA animada entre dos lugares (flecha
// A→B), estilo war-room / After Effects. Para "los alemanes avanzaron de Berlín a París".
// items = [origen, destino]. Si conoce las ciudades (tabla lat/lon) usa geografía REAL
// (dirección correcta); si no, posiciones genéricas. Panel oscuro, no tapa el sentido.
const CITY_LL: Record<string, [number, number]> = {
  berlin: [52.52, 13.40], paris: [48.85, 2.35], londres: [51.51, -0.13], london: [51.51, -0.13],
  madrid: [40.42, -3.70], barcelona: [41.39, 2.17], roma: [41.90, 12.50], rome: [41.90, 12.50],
  moscu: [55.75, 37.62], moscow: [55.75, 37.62], kiev: [50.45, 30.52], varsovia: [52.23, 21.01],
  warsaw: [52.23, 21.01], amsterdam: [52.37, 4.90], bruselas: [50.85, 4.35], brussels: [50.85, 4.35],
  viena: [48.21, 16.37], vienna: [48.21, 16.37], praga: [50.08, 14.44], lisboa: [38.72, -9.14],
  atenas: [37.98, 23.73], estambul: [41.01, 28.98], dunkerque: [51.03, 2.38], normandia: [49.18, -0.37],
  hamburgo: [53.55, 9.99], munich: [48.14, 11.58], stalingrado: [48.71, 44.51], leningrado: [59.93, 30.34],
  washington: [38.90, -77.04], 'nueva york': [40.71, -74.01], 'new york': [40.71, -74.01],
  'nueva jersey': [40.74, -74.17], manhattan: [40.78, -73.97],
  tokio: [35.68, 139.69], pekin: [39.90, 116.40], pearl: [21.36, -157.95],
};
const _normCity = (s: string) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const resolveCity = (item: string): {label: string; lat: number; lon: number} | null => {
  const n = _normCity(item);
  for (const key of Object.keys(CITY_LL)) {
    if (n.includes(key)) {
      const [lat, lon] = CITY_LL[key];
      return {label: shortCopy(item, 3, 18), lat, lon};
    }
  }
  return null;
};

const MapRoute: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const items = (event.items || []).map((s) => clean(s)).filter(Boolean);
  const W = 1920, H = 1080, M = 300;          // MAPA a PANTALLA COMPLETA (no panel recortado)
  const c0 = items[0] ? resolveCity(items[0]) : null;
  const c1 = items[1] ? resolveCity(items[1]) : null;
  let p0: [number, number], p1: [number, number], l0: string, l1: string;
  const single = !c1 && !items[1];
  if (c0 && c1) {
    const latC = (c0.lat + c1.lat) / 2, lonC = (c0.lon + c1.lon) / 2;
    // Rutas cercanas necesitan más zoom: con una ventana mínima de 3° los topónimos
    // de un mismo entorno urbano se amontonan (caso Nueva Jersey–Manhattan).
    const latR = Math.max(0.7, Math.abs(c0.lat - c1.lat)) * 1.9;
    const lonR = Math.max(0.7, Math.abs(c0.lon - c1.lon)) * 1.9;
    const proj = (lat: number, lon: number): [number, number] => [
      M + ((lon - (lonC - lonR / 2)) / lonR) * (W - 2 * M),
      M + (((latC + latR / 2) - lat) / latR) * (H - 2 * M),
    ];
    p0 = proj(c0.lat, c0.lon); p1 = proj(c1.lat, c1.lon); l0 = c0.label; l1 = c1.label;
  } else {
    p0 = single ? [W / 2, H / 2] : [M + 40, H * 0.62];
    p1 = [W - M - 40, H * 0.40];
    l0 = shortCopy(items[0] || 'Origen', 3, 18); l1 = shortCopy(items[1] || '', 3, 18);
  }
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const len = Math.max(1, Math.hypot(dx, dy));
  const tight = len < 260;
  const bow = Math.min(180, len * 0.34);
  const nx = -dy / len, ny = dx / len;
  const upSign = ny >= 0 ? -1 : 1;            // siempre arquea hacia arriba
  const ctrlX = mx + nx * bow * upSign, ctrlY = my + ny * bow * upSign;
  const draw = interpolate(frame, [Math.round(fps * 0.3), Math.round(fps * 1.5)], [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const bez = (tt: number): [number, number] => {
    const u = 1 - tt;
    return [u * u * p0[0] + 2 * u * tt * ctrlX + tt * tt * p1[0],
            u * u * p0[1] + 2 * u * tt * ctrlY + tt * tt * p1[1]];
  };
  const head = bez(draw);
  const pathD = `M ${p0[0]} ${p0[1]} Q ${ctrlX} ${ctrlY} ${p1[0]} ${p1[1]}`;
  const dotR = interpolate(t.intro, [0, 1], [0, 11]);
  const title = shortCopy(event.title, 8, 40);
  // distancia real (haversine) entre las dos ciudades → toque de realismo ("≈ 880 km")
  const R = 6371, rad = Math.PI / 180;
  const kmDist = (c0 && c1)
    ? Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(
        Math.sin((c1.lat - c0.lat) * rad / 2) ** 2 +
        Math.cos(c0.lat * rad) * Math.cos(c1.lat * rad) * Math.sin((c1.lon - c0.lon) * rad / 2) ** 2))))
    : 0;
  const grid: React.ReactNode[] = [];
  for (let x = 110; x < W; x += 130) grid.push(<line key={'vx' + x} x1={x} y1={0} x2={x} y2={H} stroke="#9fd0e6" strokeOpacity={0.05} strokeWidth={1} />);
  for (let y = 110; y < H; y += 130) grid.push(<line key={'hy' + y} x1={0} y1={y} x2={W} y2={y} stroke="#9fd0e6" strokeOpacity={0.05} strokeWidth={1} />);
  // meridianos curvos (sensación de globo)
  const meridians = [0.28, 0.5, 0.72].map((fx, i) => {
    const cx = W * fx;
    return <path key={'m' + i} d={`M ${cx} 0 Q ${cx + (fx - 0.5) * 260} ${H / 2} ${cx} ${H}`} fill="none" stroke="#9fd0e6" strokeOpacity={0.06} strokeWidth={1.4} />;
  });
  return (
    <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.font}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width: '100%', height: '100%', display: 'block'}}>
        <defs>
          <radialGradient id="ocean" cx="48%" cy="40%" r="82%">
            <stop offset="0%" stopColor="#0c2a3d" />
            <stop offset="55%" stopColor="#081825" />
            <stop offset="100%" stopColor="#03070c" />
          </radialGradient>
          <radialGradient id="terr" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.18" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#ocean)" />
        {meridians}
        {grid}
        {/* glow de "terreno" suave bajo la ruta para que no sea solo rejilla */}
        <ellipse cx={(p0[0] + p1[0]) / 2} cy={(p0[1] + p1[1]) / 2} rx={Math.max(360, Math.abs(p1[0] - p0[0]) * 0.9)} ry={260} fill="url(#terr)" />
        {/* anillos de alcance desde el origen */}
        {[160, 320, 500].map((r) => (
          <circle key={'r' + r} cx={p0[0]} cy={p0[1]} r={r * Math.min(1, draw * 1.4)} fill="none" stroke={accent} strokeOpacity={0.13} />
        ))}
        {/* ruta planificada (punteada) + ruta dibujada (sólida con glow) + flecha */}
        {!single ? <path d={pathD} fill="none" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="2.5" strokeDasharray="10 12" /> : null}
        {!single ? (
          <path d={pathD} fill="none" stroke={accent} strokeWidth="7" strokeLinecap="round"
            pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw}
            style={{filter: `drop-shadow(0 0 12px ${accent})`}} />
        ) : null}
        <circle cx={p0[0]} cy={p0[1]} r={dotR + 9} fill="none" stroke={accent} strokeOpacity="0.55" strokeWidth="2" />
        <circle cx={p0[0]} cy={p0[1]} r={dotR} fill={accent} />
        {!single && draw < 0.99 ? <circle cx={head[0]} cy={head[1]} r="11" fill="#fff" style={{filter: 'drop-shadow(0 0 9px #fff)'}} /> : null}
        {!single ? <circle cx={p1[0]} cy={p1[1]} r={dotR * Math.min(1, draw * 1.6)} fill="#fff" /> : null}
        <text x={p0[0]} y={p0[1] + 52} fill="#eaf6ff" fontSize="38" fontWeight="800" textAnchor="middle" style={{paintOrder: 'stroke', stroke: '#000', strokeWidth: 5}}>{l0}</text>
        {!single ? <text x={p1[0]} y={p1[1] - 34} fill="#ffffff" fontSize="42" fontWeight="900" textAnchor="middle" opacity={draw > 0.55 ? 1 : 0} style={{paintOrder: 'stroke', stroke: '#000', strokeWidth: 5}}>{l1}</text> : null}
        {/* distancia real en el centro de la ruta */}
        {!single && kmDist > 0 && draw > 0.7 ? (
          <text x={ctrlX} y={tight ? ctrlY + 74 : ctrlY - 14} fill={accent} fontSize="30" fontWeight="800" textAnchor="middle" style={{paintOrder: 'stroke', stroke: '#000', strokeWidth: 5}}>{`≈ ${kmDist.toLocaleString('es-ES')} km`}</text>
        ) : null}
        {title ? <text x={M * 0.55} y={92} fill={accent} fontSize="40" fontWeight="800" style={{textTransform: 'uppercase', letterSpacing: 2, paintOrder: 'stroke', stroke: '#000', strokeWidth: 6}}>{title}</text> : null}
      </svg>
    </AbsoluteFill>
  );
};

// ── CROSS-SECTION / CUTAWAY (esquema "Beyond Military") — vista de PERFIL en corte del
// subsuelo: un TÚNEL enterrado (o infraestructura) con cotas de longitud/profundidad y
// LLAMADAS numeradas a sus partes (riel, ventilación, la moto…). Líneas técnicas PLANAS
// (cero neón/glow) = look de plano de documental real, NO "plantilla de IA". El túnel se
// EXCAVA (se dibuja de entrada a salida con una cabeza que avanza) y cada llamada aparece
// cuando la excavación pasa por su punto. items = partes; el título va en resaltador.
// Detecta "1,5 km" / "10 m" del texto para rotular las cotas (si no, no inventa números).
const _grab = (re: RegExp, s: string): string => {
  const m = re.exec(s || ''); return m ? m[0].replace(/\s+/g, ' ').trim() : '';
};
const CrossSection: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const title = shortCopy(event.title, 5, 40);
  const parts = realItems(event).slice(0, 5);
  const blob = `${clean(event.title)} ${clean(event.subtitle)} ${(event.items || []).join(' ')}`;
  const lenTxt = _grab(/\d[\d.,]*\s?(km|kil[óo]metros?|millas?|mi\b)/i, blob);
  const depTxt = _grab(/\d[\d.,]*\s?(m\b|metros?|pies?|ft)\b/i, blob);
  const up = th.upper ? 'uppercase' as const : 'none' as const;

  const W = 1920, H = 1080;
  const surfaceY = 372, floorY = 792;       // línea de superficie y suelo del túnel
  const Lx = 322, Rx = 1598;                // bocas de entrada (A) y salida (B)
  const path = `M ${Lx} ${surfaceY} L ${Lx} ${floorY} L ${Rx} ${floorY} L ${Rx} ${surfaceY}`;
  // "Excavación": el trazo se dibuja de principio a fin en ~1.35s (easing = TBM avanzando).
  const dig = interpolate(frame, [Math.round(fps * 0.25), Math.round(fps * 1.6)], [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const vSeg = floorY - surfaceY, hSeg = Rx - Lx, total = vSeg * 2 + hSeg;
  const nMark = parts.length;
  const markX = (i: number) => Lx + ((i + 1) / (nMark + 1)) * (Rx - Lx);
  const passedAt = (x: number) => (vSeg + (x - Lx)) / total;   // fracción de recorrido en ese x
  // punto de la cabeza de excavación sobre la L (para el "topo" que avanza)
  const d = dig * total;
  const head: [number, number] = d < vSeg ? [Lx, surfaceY + d]
    : d < vSeg + hSeg ? [Lx + (d - vSeg), floorY]
    : [Rx, floorY - (d - vSeg - hSeg)];
  const layers = [1, 2, 3].map((k) => surfaceY + k * ((H - surfaceY) / 4));

  return (
    <AbsoluteFill style={{opacity: t.opacity, fontFamily: th.font}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width: '100%', height: '100%', display: 'block'}}>
        {/* corte de tierra: capa fina sobre la superficie + subsuelo más oscuro debajo */}
        {/* Scrim del corte. 2026-07-17: subido de 0.40/0.60 a 0.80/0.92 — sobre metraje RUIDOSO
            (escombros, archivo) el esquema no se leía y competía con el fondo. El demo que el
            usuario aprobó tenía fondo navy limpio; esto lo replica dejando solo una insinuación
            del metraje detrás. Ajustable con CUTAWAY_SCRIM (0..1). */}
        <rect x="0" y="0" width={W} height={surfaceY} fill="rgba(6,10,16,0.80)" />
        <rect x="0" y={surfaceY} width={W} height={H - surfaceY} fill="rgba(3,5,8,0.92)" />
        {layers.map((y, k) => (
          <line key={'ly' + k} x1="0" y1={y} x2={W} y2={y} stroke="#ffffff" strokeOpacity={0.045} strokeWidth={1} />
        ))}
        {/* línea de SUPERFICIE (terreno) */}
        <line x1="0" y1={surfaceY} x2={W} y2={surfaceY} stroke="#e8eef2" strokeOpacity={0.85} strokeWidth={3} />
        {/* edificios de boca (entrada A / salida B) sobre la superficie */}
        <g stroke="#e8eef2" strokeOpacity={0.72} strokeWidth={2.5} fill="none">
          <rect x={Lx - 46} y={surfaceY - 90} width={92} height={90} />
          <path d={`M ${Lx - 46} ${surfaceY - 90} L ${Lx} ${surfaceY - 124} L ${Lx + 46} ${surfaceY - 90}`} />
          <rect x={Rx - 46} y={surfaceY - 90} width={92} height={90} />
          <path d={`M ${Rx - 46} ${surfaceY - 90} L ${Rx} ${surfaceY - 124} L ${Rx + 46} ${surfaceY - 90}`} />
        </g>
        <text x={Lx} y={surfaceY - 138} fill="#e8eef2" fontSize="26" fontWeight="800" textAnchor="middle" opacity={0.9}>A</text>
        <text x={Rx} y={surfaceY - 138} fill="#e8eef2" fontSize="26" fontWeight="800" textAnchor="middle" opacity={dig > 0.9 ? 0.9 : 0}>B</text>
        {/* túnel EXCAVADO: halo oscuro ancho + trazo de acento que se dibuja de A→B */}
        <path d={path} fill="none" stroke="#000" strokeOpacity={0.55} strokeWidth={30} strokeLinecap="round" strokeLinejoin="round"
          pathLength={1} strokeDasharray={1} strokeDashoffset={1 - dig} />
        <path d={path} fill="none" stroke={accent} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round"
          pathLength={1} strokeDasharray={1} strokeDashoffset={1 - dig} />
        {/* cabeza de excavación (el "topo" avanzando) */}
        {dig > 0.02 && dig < 0.985 ? <circle cx={head[0]} cy={head[1]} r={10} fill="#fff" /> : null}
        {/* cota de LONGITUD (horizontal, bajo el túnel) — solo si el texto la trae */}
        {lenTxt ? (
          <g opacity={dig > 0.85 ? 1 : 0}>
            <line x1={Lx} y1={floorY + 54} x2={Rx} y2={floorY + 54} stroke={accent} strokeWidth={2} />
            <line x1={Lx} y1={floorY + 42} x2={Lx} y2={floorY + 66} stroke={accent} strokeWidth={2} />
            <line x1={Rx} y1={floorY + 42} x2={Rx} y2={floorY + 66} stroke={accent} strokeWidth={2} />
            <rect x={(Lx + Rx) / 2 - 100} y={floorY + 34} width={200} height={40} fill="#04060a" />
            <text x={(Lx + Rx) / 2} y={floorY + 62} fill={accent} fontSize="30" fontWeight="800" textAnchor="middle" style={{letterSpacing: 1}}>{lenTxt.toUpperCase()}</text>
          </g>
        ) : null}
        {/* cota de PROFUNDIDAD (vertical, en el pozo izq) — solo si es distinta de la longitud */}
        {depTxt && depTxt !== lenTxt ? (
          <g opacity={dig > 0.45 ? 1 : 0}>
            <line x1={Lx - 78} y1={surfaceY} x2={Lx - 78} y2={floorY} stroke={accent} strokeWidth={2} />
            <line x1={Lx - 90} y1={surfaceY} x2={Lx - 66} y2={surfaceY} stroke={accent} strokeWidth={2} />
            <line x1={Lx - 90} y1={floorY} x2={Lx - 66} y2={floorY} stroke={accent} strokeWidth={2} />
            <text x={Lx - 96} y={(surfaceY + floorY) / 2} fill={accent} fontSize="26" fontWeight="800" textAnchor="middle" transform={`rotate(-90 ${Lx - 96} ${(surfaceY + floorY) / 2})`}>{depTxt.toUpperCase()}</text>
          </g>
        ) : null}
        {/* LLAMADAS numeradas a las partes (marcador en el túnel + guía + rótulo, dos alturas) */}
        {parts.map((p, i) => {
          const x = markX(i);
          const labelY = floorY - 150 - (i % 2) * 96;
          const app = interpolate(dig, [passedAt(x) - 0.02, passedAt(x) + 0.07], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const lab = shortCopy(p, 3, 26);
          return (
            <g key={'ct' + i} opacity={app} transform={`translate(0 ${(1 - app) * 10})`}>
              <line x1={x} y1={floorY - 8} x2={x} y2={labelY + 20} stroke={accent} strokeOpacity={0.55} strokeWidth={2} />
              <circle cx={x} cy={floorY} r={8} fill={accent} />
              <circle cx={x} cy={labelY} r={18} fill="#04060a" stroke={accent} strokeWidth={2.5} />
              <text x={x} y={labelY + 7} fill={accent} fontSize="22" fontWeight="900" textAnchor="middle">{i + 1}</text>
              <text x={x} y={labelY - 30} fill="#fff" fontSize="24" fontWeight="700" textAnchor="middle" style={{paintOrder: 'stroke', stroke: '#000', strokeWidth: 5, textTransform: up}}>{lab}</text>
            </g>
          );
        })}
      </svg>
      {/* título en RESALTADOR (HTML = tipografía nítida), arriba-izq */}
      {title ? (
        <div style={{position: 'absolute', left: PAD, top: PAD, transform: `translateY(${t.y}px)`}}>
          <span style={{background: accent, color: '#0b0b0b', fontSize: 36, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4, padding: '4px 13px', WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone'} as React.CSSProperties}>{title}</span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ── PYRAMID / HIERARCHY (esquema de jerarquía PLANO, mismo estilo documental que CrossSection) —
// N niveles (N = nº de items, 2–5) apilados en pirámide: el VÉRTICE (pocos, el líder/rango alto)
// arriba y la BASE (muchos) abajo. Los niveles aparecen de ABAJO→ARRIBA con el intro de timing().
// Sin neón/3D/glow: SVG limpio, acento del tema, título en RESALTADOR (fontDisplay), etiquetas de
// nivel en fontLabel. items = niveles (mismo filtro de ruido que realItems). Para jerarquías reales:
// líder→lugartenientes→base, o "nivel/rango/tier" explícito. Con <2 niveles reales NO se selecciona.
const Pyramid: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent;
  const title = shortCopy(event.title, 5, 40);
  // niveles: mismo filtro de ruido que realItems pero hasta 5 (realItems corta a 4).
  const tiers = (event.items || [])
    .map((s) => clean(s))
    .filter((s) => s.length > 2 && !JUNK_ITEMS.has(s.toLowerCase()))
    .slice(0, 5);
  const n = Math.max(1, tiers.length);
  const up = th.upper ? 'uppercase' as const : 'none' as const;

  const W = 1920, H = 1080;
  const blueprint = String(event.theme || event.remotionTheme || '').toLowerCase() === 'constructum';
  const cx = W * 0.42;                       // pirámide a la izq-centro; deja aire a la dcha para etiquetas
  const apexY = 300, baseY = 908;            // vértice y base de la pirámide
  const baseHalf = 360;                      // semiancho de la base
  const tierH = (baseY - apexY) / n;
  const fracAt = (y: number) => (y - apexY) / (baseY - apexY);   // 0 en el vértice, 1 en la base

  return (
    <AbsoluteFill style={{opacity: t.opacity, background: blueprint ? '#07101e' : 'transparent', fontFamily: th.font}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width: '100%', height: '100%', display: 'block'}}>
        {blueprint ? <g opacity={0.22}>
          {Array.from({length: 21}, (_, i) => <line key={`px${i}`} x1={i * 96} y1="0" x2={i * 96} y2={H} stroke="#a9c2dd" strokeOpacity={0.16} />)}
          {Array.from({length: 12}, (_, i) => <line key={`py${i}`} x1="0" y1={i * 96} x2={W} y2={i * 96} stroke="#a9c2dd" strokeOpacity={0.16} />)}
        </g> : null}
        {/* scrim MUY suave para legibilidad, sin tapar el metraje */}
        <rect x="0" y="0" width={W} height={H} fill={blueprint ? 'rgba(4,6,10,0.12)' : 'rgba(4,6,10,0.28)'} />
        {tiers.map((label, i) => {
          const yTop = apexY + i * tierH;
          const yBot = yTop + tierH;
          const topH = Math.max(6, fracAt(yTop) * baseHalf);   // vértice = casi un punto
          const botH = fracAt(yBot) * baseHalf;
          // aparición ABAJO→ARRIBA: la base (i = n-1) entra primero, el vértice el último.
          const orderFromBottom = n - 1 - i;
          const app = interpolate(t.intro,
            [0.12 * orderFromBottom, 0.12 * orderFromBottom + 0.42], [0, 1],
            {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const midY = (yTop + yBot) / 2;
          const edgeX = cx + (topH + botH) / 2;                // borde derecho del nivel a media altura
          const labelX = cx + botH + 46;                       // etiqueta a la derecha, fuera de la pirámide
          const lab = shortCopy(label, 4, 24);
          return (
            <g key={'py' + i} opacity={app} transform={`translate(0 ${(1 - app) * 12})`}>
              <polygon
                points={`${cx - topH},${yTop} ${cx + topH},${yTop} ${cx + botH},${yBot} ${cx - botH},${yBot}`}
                fill={accent} fillOpacity={0.14 + fracAt(yBot) * 0.24}
                stroke={accent} strokeWidth={2.4} strokeLinejoin="round" />
              {/* conector + etiqueta del nivel (fontLabel) a la derecha */}
              <line x1={edgeX} y1={midY} x2={labelX - 12} y2={midY} stroke={accent} strokeOpacity={0.5} strokeWidth={2} />
              <circle cx={edgeX} cy={midY} r={5} fill={accent} />
              <text x={labelX} y={midY + 9} fill="#fff" fontSize={30} fontWeight={700} fontFamily={th.fontLabel}
                style={{paintOrder: 'stroke', stroke: '#000', strokeWidth: 5, textTransform: up}}>{lab}</text>
            </g>
          );
        })}
      </svg>
      {/* título en RESALTADOR (HTML = tipografía nítida), arriba-izq — mismo estilo que CrossSection */}
      {title ? (
        <div style={{position: 'absolute', left: PAD, top: PAD, transform: `translateY(${t.y}px)`}}>
          <span style={{background: accent, color: '#0b0b0b', fontFamily: th.fontDisplay, fontSize: 36, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4, padding: '4px 13px', WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone'} as React.CSSProperties}>{title}</span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ── ENGINEERING SCHEMATIC — gramática de construcción inspirada en Constructum. ──
// La pieza no intenta ser un render 3D: es un plano editorial 2D con una sola idea, líneas
// finas, dibujo progresivo y etiquetas que vienen de la voz. `schematicKind` permite a MiniMax
// elegir la lectura correcta: solar, comparación, planta, fachada, cimentación, proceso o línea
// temporal. Si el planner no aporta una subfamilia válida, se usa una planta estructural sobria.
const EngineeringSchematic: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = timing(event, frame, fps);
  const th = themeOf(event);
  const accent = event.accent || th.accent || '#f2a51a';
  const mode = String(event.schematicKind || (
    event.type === 'structure_compare' ? 'structure_compare' :
    event.type === 'site_plan' ? 'site_plan' :
    event.type === 'process_flow' ? 'process_flow' :
    event.type === 'timeline' ? 'timeline' : 'floor_plan'
  )).toLowerCase();
  const items = realItems(event).slice(0, 5);
  const title = shortCopy(event.title, 8, 52);
  const subtitle = shortCopy(event.subtitle, 10, 80);
  const draw = interpolate(frame, [Math.round(fps * 0.12), Math.round(fps * 1.55)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const W = 1920, H = 1080;
  const isEs = String(event.lang || 'es').toLowerCase().startsWith('es');
  const heading = mode === 'site_plan' ? (isEs ? 'PLANO DE IMPLANTACIÓN' : 'SITE PLAN')
    : mode === 'structure_compare' ? (isEs ? 'COMPARACIÓN DE ESTRUCTURAS' : 'STRUCTURE COMPARISON')
    : mode === 'floor_plan' ? (isEs ? 'PLANTA ESTRUCTURAL' : 'STRUCTURAL PLAN')
    : mode === 'facade_section' ? (isEs ? 'ALZADO · EN SECCIÓN' : 'ELEVATION · SECTION')
    : mode === 'column_section' ? (isEs ? 'SECCIÓN DE LA COLUMNA' : 'COLUMN SECTION')
    : mode === 'foundation_section' ? (isEs ? 'CIMENTACIÓN · TERRENO' : 'FOUNDATION · GROUND')
    : mode === 'jacking_sequence' ? (isEs ? 'SECUENCIA DE ELEVACIÓN' : 'JACKING SEQUENCE')
    : mode === 'process_flow' ? (isEs ? 'SECUENCIA CONSTRUCTIVA' : 'CONSTRUCTION SEQUENCE')
    : mode === 'timeline' ? (isEs ? 'LÍNEA DE TIEMPO' : 'TIMELINE')
    : (isEs ? 'ESQUEMA ESTRUCTURAL' : 'ENGINEERING SCHEMATIC');
  const fade = Math.min(1, t.opacity * Math.max(0.2, draw));
  const cleanLabel = (raw: string, max = 25) => shortCopy(raw.replace(/^\s*[-•]\s*/, ''), 4, max);
  const valueFor = (raw: string) => {
    const m = raw.match(/(\d[\d.,]*)\s*(m|km|%|€|\$|millones?|million|plantas?|floors?)?/i);
    if (!m) return '';
    return `${m[1]}${m[2] ? ` ${m[2]}` : ''}`;
  };
  const labelFor = (raw: string) => cleanLabel(raw.split(/\s*:\s*/)[0] || raw, 22);
  const nodes = items.length >= 2 ? items : [
    isEs ? 'Parte superior' : 'Upper level', isEs ? 'Soporte central' : 'Central support',
    isEs ? 'Cimentación' : 'Foundation',
  ];
  const line = (x1: number, y1: number, x2: number, y2: number, key: string, color = '#d8e1ee', width = 2, opacity = 0.75) => (
    <line key={key} x1={x1} y1={y1} x2={x1 + (x2 - x1) * draw} y2={y1 + (y2 - y1) * draw}
      stroke={color} strokeWidth={width} strokeOpacity={opacity} />
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number, key: string) => (
    <g key={key} opacity={draw}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={accent} strokeWidth={5} />
      <path d={`M ${x2} ${y2} l -18 -11 l 4 20 z`} fill={accent} />
    </g>
  );
  const bgLines: React.ReactNode[] = [];
  for (let x = 0; x <= W; x += 96) bgLines.push(<line key={`gx${x}`} x1={x} y1={0} x2={x} y2={H} stroke="#a9c2dd" strokeOpacity={0.035} />);
  for (let y = 0; y <= H; y += 96) bgLines.push(<line key={`gy${y}`} x1={0} y1={y} x2={W} y2={y} stroke="#a9c2dd" strokeOpacity={0.035} />);

  let drawing: React.ReactNode;
  if (mode === 'site_plan') {
    const blocks = Array.from({length: 18}, (_, i) => {
      const col = i % 6, row = Math.floor(i / 6);
      const x = 300 + col * 196, y = 240 + row * 170;
      const selected = i >= 7 && i <= 12;
      return <rect key={`b${i}`} x={x} y={y} width={154} height={122} fill={selected ? `${accent}33` : '#c4cfdd12'} stroke={selected ? accent : '#c4cfdd55'} strokeWidth={selected ? 4 : 2} opacity={draw} />;
    });
    drawing = <>
      <path d="M 1220 80 C 1140 260 1260 420 1175 600 S 1210 850 1120 1080" fill="none" stroke="#487eb0" strokeWidth="130" strokeOpacity={0.42 * draw} />
      {blocks}
      {line(270, 210, 1440, 210, 'site-road1', '#dbe5f2', 3, 0.42)}
      {line(270, 730, 1440, 730, 'site-road2', '#dbe5f2', 3, 0.42)}
      <rect x="522" y="370" width="560" height="300" fill={`${accent}24`} stroke={accent} strokeWidth="5" strokeDasharray="14 11" opacity={draw} />
      <text x="802" y="530" fill="#fff" textAnchor="middle" fontSize="34" fontWeight="800">{cleanLabel(items[0] || (isEs ? 'SOLAR' : 'SITE'), 18)}</text>
      <text x="1240" y="150" fill="#d6e5f6" textAnchor="middle" fontSize="24" letterSpacing="3">{cleanLabel(items.find((x) => /río|river|hudson|agua|water/i.test(x)) || (isEs ? 'RÍO' : 'RIVER'), 18)}</text>
    </>;
  } else if (mode === 'structure_compare') {
    const vals = items.map((x) => Number((x.match(/\d[\d.,]*/) || ['0'])[0].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || 0);
    const max = Math.max(...vals, 1);
    const hs = vals.length >= 2 && vals[0] > 0 && vals[1] > 0 ? vals.slice(0, 2).map((v) => 470 * v / max) : [390, 470];
    const bx = [560, 1080];
    drawing = <>
      {line(330, 880, 1550, 880, 'cmp-ground', '#dce5f1', 3, 0.55)}
      {hs.map((h, i) => {
        const w = i === 0 ? 170 : 188;
        const x = bx[i] - w / 2, y = 880 - h * draw;
        const rows = Math.max(6, Math.round(h / 25));
        return <g key={`cmp${i}`}>
          <rect x={x} y={y} width={w} height={h * draw} fill={i === 1 ? `${accent}28` : '#b6c8e130'} stroke={i === 1 ? accent : '#b6c8e1'} strokeWidth="4" />
          {Array.from({length: rows}, (_, r) => <line key={r} x1={x + 13} y1={y + 18 + r * ((h - 30) / rows)} x2={x + w - 13} y2={y + 18 + r * ((h - 30) / rows)} stroke={i === 1 ? accent : '#cbd8e5'} strokeOpacity={0.45} strokeWidth="3" />)}
          <text x={bx[i]} y={930} fill="#fff" textAnchor="middle" fontSize="27" fontWeight="800">{labelFor(items[i] || `${i + 1}`)}</text>
          {valueFor(items[i] || '') ? <text x={bx[i]} y={975} fill={i === 1 ? accent : '#d8e1ee'} textAnchor="middle" fontSize="30" fontWeight="800">{valueFor(items[i] || '')}</text> : null}
        </g>;
      })}
    </>;
  } else if (mode === 'column_section') {
    drawing = <>
      {Array.from({length: 15}, (_, i) => line(280 + i * 100, 180, 280 + i * 100, 890, `colgrid${i}`, '#9eb4ce', 2, 0.24))}
      <rect x="760" y="320" width="400" height="400" fill={`${accent}18`} stroke={accent} strokeWidth="5" opacity={draw} />
      <rect x="800" y="360" width="320" height="320" fill="none" stroke="#d7e1ee" strokeWidth="4" opacity={draw} />
      {line(1160, 520, 1375, 430, 'col-call', '#fff', 2, 0.85)}
      <text x="1400" y="425" fill={accent} fontSize="34" fontWeight="800">{valueFor(subtitle) || valueFor(items[0] || '')}</text>
      <text x="960" y="790" fill="#d8e1ee" textAnchor="middle" fontSize="24" letterSpacing="3">{cleanLabel(items[1] || (isEs ? 'TUBO ESTRUCTURAL' : 'STRUCTURAL TUBE'), 24)}</text>
    </>;
  } else if (mode === 'facade_section') {
    drawing = <>
      <rect x="650" y="190" width="520" height="650" fill="none" stroke="#cfdbeb" strokeWidth="4" opacity={draw} />
      {Array.from({length: 8}, (_, i) => <g key={`fl${i}`} opacity={draw}><line x1="650" y1={270 + i * 70} x2="1170" y2={270 + i * 70} stroke="#9fb2c8" strokeWidth="3" /><line x1="700" y1={270 + i * 70} x2="700" y2={330 + i * 70} stroke={accent} strokeWidth="4" /><line x1="1120" y1={270 + i * 70} x2="1120" y2={330 + i * 70} stroke={accent} strokeWidth="4" /></g>)}
      <rect x="1230" y="200" width="38" height="630" fill={`${accent}35`} stroke={accent} strokeWidth="3" opacity={draw} />
      {line(1270, 390, 1460, 330, 'facade-call', '#fff', 2, 0.8)}
      <text x="1480" y="326" fill={accent} fontSize="32" fontWeight="800">{cleanLabel(items[0] || (isEs ? 'MURO CORTINA' : 'CURTAIN WALL'), 20)}</text>
    </>;
  } else if (mode === 'foundation_section') {
    drawing = <>
      <rect x="0" y="470" width={W} height="610" fill="#5d5b48" fillOpacity={0.42 * draw} />
      {Array.from({length: 4}, (_, i) => <line key={`soil${i}`} x1="0" y1={560 + i * 105} x2={W} y2={560 + i * 105} stroke="#c0bba3" strokeOpacity={0.22} strokeWidth="2" />)}
      <line x1="0" y1="470" x2={W} y2="470" stroke="#e0e8f2" strokeWidth="4" opacity={draw} />
      <rect x="660" y="285" width="600" height="170" fill="none" stroke="#d9e3ef" strokeWidth="4" opacity={draw} />
      <rect x="720" y="455" width="480" height="245" fill={`${accent}30`} stroke={accent} strokeWidth="5" opacity={draw} />
      {arrow(960, 220, 960, 410, 'foundation-arrow')}
      <text x="960" y="780" fill="#fff" textAnchor="middle" fontSize="30" fontWeight="800">{cleanLabel(items[0] || (isEs ? 'CIMENTACIÓN' : 'FOUNDATION'), 24)}</text>
    </>;
  } else if (mode === 'jacking_sequence') {
    drawing = <>
      <rect x="670" y="220" width="580" height="550" fill="none" stroke="#d4dfec" strokeWidth="4" opacity={draw} />
      {Array.from({length: 8}, (_, i) => <line key={`jackfloor${i}`} x1="670" y1={290 + i * 60} x2="1250" y2={290 + i * 60} stroke="#a7b9ce" strokeOpacity={0.4} strokeWidth="2" />)}
      {Array.from({length: 5}, (_, i) => <g key={`jack${i}`} opacity={draw}><rect x={720 + i * 118} y="795" width="32" height="120" fill={`${accent}44`} stroke={accent} strokeWidth="3" /><line x1={736 + i * 118} y1="795" x2={736 + i * 118} y2="710" stroke={accent} strokeWidth="5" /></g>)}
      {arrow(1370, 820, 1370, 620, 'jack-arrow')}
      <text x="960" y="995" fill={accent} textAnchor="middle" fontSize="31" fontWeight="800">{cleanLabel(items[0] || (isEs ? 'GATOS HIDRÁULICOS' : 'HYDRAULIC JACKS'), 28)}</text>
    </>;
  } else if (mode === 'process_flow') {
    const n = Math.max(2, Math.min(5, nodes.length));
    drawing = <>
      {Array.from({length: n}, (_, i) => {
        const x = 310 + i * (1290 / Math.max(1, n - 1));
        const active = interpolate(draw, [i / n, Math.min(1, i / n + 0.32)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        return <g key={`flow${i}`} opacity={active}>
          <circle cx={x} cy="500" r="54" fill={`${accent}22`} stroke={accent} strokeWidth="4" />
          <text x={x} y="512" fill={accent} textAnchor="middle" fontSize="31" fontWeight="900">{i + 1}</text>
          <text x={x} y="610" fill="#fff" textAnchor="middle" fontSize="28" fontWeight="700">{cleanLabel(nodes[i] || '', 22)}</text>
          {i < n - 1 ? <line x1={x + 60} y1="500" x2={x + 1290 / Math.max(1, n - 1) - 66} y2="500" stroke="#d8e1ee" strokeWidth="3" opacity={0.55} /> : null}
        </g>;
      })}
    </>;
  } else if (mode === 'timeline') {
    const n = Math.max(2, Math.min(5, nodes.length));
    drawing = <>
      <line x1="250" y1="520" x2="1670" y2="520" stroke="#dbe4ef" strokeWidth="4" opacity={0.72 * draw} />
      {Array.from({length: n}, (_, i) => {
        const x = 300 + i * (1320 / Math.max(1, n - 1));
        return <g key={`time${i}`} opacity={draw}>
          <circle cx={x} cy="520" r="18" fill={i === n - 1 ? accent : '#dbe4ef'} />
          <line x1={x} y1="520" x2={x} y2={i % 2 ? 390 : 650} stroke={accent} strokeWidth="3" />
          <text x={x} y={i % 2 ? 355 : 715} fill={accent} textAnchor="middle" fontSize="25" fontWeight="900">{cleanLabel(nodes[i] || '', 28).split(':')[0]}</text>
          <text x={x} y={i % 2 ? 390 : 750} fill="#fff" textAnchor="middle" fontSize="22" fontWeight="600">{cleanLabel(nodes[i] || '', 30).split(':').slice(1).join(':').trim()}</text>
        </g>;
      })}
    </>;
  } else {
    // Planta estructural por defecto: núcleo, perímetro, columnas y flujo de carga.
    drawing = <>
      <rect x="560" y="220" width="800" height="600" fill="none" stroke="#d5dfeb" strokeWidth="4" opacity={draw} />
      <rect x="850" y="350" width="220" height="340" fill={`${accent}32`} stroke={accent} strokeWidth="5" opacity={draw} />
      {Array.from({length: 18}, (_, i) => { const x = 630 + (i % 6) * 145, y = 290 + Math.floor(i / 6) * 210; return <circle key={`col${i}`} cx={x} cy={y} r="9" fill={accent} opacity={draw * 0.8} />; })}
      {arrow(960, 150, 960, 330, 'floor-arrow')}
      <text x="960" y="880" fill="#fff" textAnchor="middle" fontSize="31" fontWeight="800">{cleanLabel(items[0] || (isEs ? 'NÚCLEO CENTRAL' : 'CENTRAL CORE'), 24)}</text>
    </>;
  }

  return (
    <AbsoluteFill style={{opacity: fade, background: '#07101e', fontFamily: th.font}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width: '100%', height: '100%', display: 'block'}}>
        {bgLines}
        {drawing}
      </svg>
      <div style={{position: 'absolute', left: PAD, top: PAD, color: accent, fontFamily: th.fontLabel, fontSize: 22, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase'}}>{heading}</div>
      {title ? <div style={{position: 'absolute', left: PAD, bottom: 48, maxWidth: '76%', color: '#fff', fontFamily: th.fontDisplay, fontSize: 52, fontWeight: 900, lineHeight: 0.98, textTransform: th.upper ? 'uppercase' : 'none', textShadow: '0 5px 20px rgba(0,0,0,.55)'}}>{title}</div> : null}
      {subtitle && !/\d/.test(subtitle) ? <div style={{position: 'absolute', right: PAD, bottom: 52, maxWidth: '28%', color: '#d5e0eb', fontFamily: th.fontLabel, fontSize: 22, lineHeight: 1.1, textAlign: 'right'}}>{subtitle}</div> : null}
    </AbsoluteFill>
  );
};

// ── Mapeo: cualquier tipo del planner → una de las 5 plantillas naturales. ──
// ── CloudMapZoom — MAPA satélite con DESCENSO desde las nubes (estilo GeoLayers / Google Earth).
// La cámara baja (zoom + pan a la localización) mientras las NUBES se apartan; al final aparece el
// PIN con la etiqueta. El MAPA es un asset que aporta el usuario (event.image, file://|http|static);
// el planner elige el mapa y el punto (targetX/targetY 0..1). Reutilizable para CUALQUIER país.
const _clampN = (v: number | undefined, d: number) =>
  (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
const _mapSrc = (s: string) => (/^(https?:|file:|data:)/.test(s) ? s : staticFile(s));
// Sprites de NUBES realistas (generados con ruido fractal, PNG con alfa) en public/clouds/.
const _CLOUD_SPRITES = ['clouds/cloud_0.png', 'clouds/cloud_1.png', 'clouds/cloud_2.png', 'clouds/cloud_3.png'];
// Nubes en los BORDES (nunca el centro/target). x,y=0..1, w=% ancho, sp=sprite, o=opacidad.
const _CLOUD_LAYOUT = [
  {x: 0.05, y: 0.12, w: 46, sp: 0, o: 0.92}, {x: 0.93, y: 0.09, w: 50, sp: 1, o: 0.9},
  {x: 0.97, y: 0.70, w: 48, sp: 2, o: 0.9}, {x: 0.08, y: 0.88, w: 52, sp: 3, o: 0.88},
  {x: 0.02, y: 0.46, w: 42, sp: 1, o: 0.82}, {x: 0.99, y: 0.38, w: 42, sp: 0, o: 0.82},
  {x: 0.42, y: 0.02, w: 44, sp: 3, o: 0.8}, {x: 0.60, y: 0.99, w: 46, sp: 2, o: 0.82},
];
// CloudMapZoom — MAPA de RELIEVE con la CÁMARA descendiendo. Las NUBES son ESTÁTICAS (parte de la
// escena, en los bordes); lo que se MUEVE es la cámara → por parallax las nubes se apartan sin
// animación propia y SIGUEN viéndose en los bordes. Al llegar: nombre en tipografía elegante +
// BANDERA + pin + flecha. El MAPA y la BANDERA los aporta el usuario (relieve real, alta resolución).
const CloudMapZoom: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const th = themeOf(event);
  // ESTILO 'modern' (referencia del usuario: mapa nav oscuro con neón): grade oscuro
  // desaturado, acento CIAN con glow, etiquetas pill flotantes, menos nubes.
  // 'clouds' = el estilo que ROTA con el vectorial (el usuario: "ese que se ve más moderno, con
  // las nubes") → lleva el MISMO grade moderno. 'natural' sigue siendo el satélite documental.
  const _ms = String(event.mapStyle || '').toLowerCase();
  const modern = _ms === 'modern' || _ms === 'clouds' || _ms === 'cloud';
  const accent = modern ? '#35e0ff' : (event.accent || th.accent);
  const tx = _clampN(event.targetX, 0.5);
  const ty = _clampN(event.targetY, 0.45);
  const label = (event.locName || event.title || '').trim();
  const flag = (event.flag || '').trim();
  const src = event.image ? _mapSrc(event.image) : '';
  const outline = Array.isArray(event.outline) ? event.outline : [];
  // RUTA luminosa opcional (arco bezier target → routeTo) que se TRAZA con la cámara.
  const rtx = typeof event.routeToX === 'number' ? _clampN(event.routeToX, 0.5) : null;
  const rty = typeof event.routeToY === 'number' ? _clampN(event.routeToY, 0.5) : null;
  const routeName = (event.routeToName || '').trim();
  const dur = Math.max(1, Math.round(fps * (event.duration || 6)));

  // CÁMARA: zoom continuo lento (ease-out). Con RUTA, el foco es el PUNTO MEDIO origen-destino
  // y el zoom se limita para que AMBOS extremos queden SIEMPRE en plano (antes el destino se
  // salía del encuadre al final y la ruta parecía "bugeada").
  const hasRoute = rtx !== null && rty !== null;
  const ox = hasRoute ? (tx + (rtx as number)) / 2 : tx;   // origen de la cámara
  const oy = hasRoute ? (ty + (rty as number)) / 2 : ty;
  const cam = interpolate(frame, [0, dur], [0, 1], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  // Arranque 1.12: los BORDES del mapa nunca entran en cámara (marcos/marcas de agua fuera).
  // Con ruta: zoom máx limitado según la separación de los puntos (ambos visibles con margen).
  const sep = hasRoute ? Math.max(Math.abs((rtx as number) - tx), Math.abs((rty as number) - ty)) : 0;
  const zMax = hasRoute ? Math.max(1.25, Math.min(2.0, 0.72 / Math.max(0.12, sep))) : 2.2;
  const mapScale = interpolate(cam, [0, 1], [1.12, zMax]);
  // Posición en PANTALLA de un punto del mapa bajo la cámara (fracciones 0..1):
  const scr = (px: number, py: number): [number, number] =>
    [ox + (px - ox) * mapScale, oy + (py - oy) * mapScale];
  const cloudScale = interpolate(cam, [0, 1], [1.0, 2.9]);   // parallax: las nubes (más cerca) pasan de largo
  const cloudFade = interpolate(cam, [0.4, 1], [1, 0.5], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  // Reveal del rótulo/pin (~35% → 55%).
  const rev = interpolate(frame, [Math.round(dur * 0.35), Math.round(dur * 0.55)], [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  // Dibujado del CONTORNO (trazo que se pinta) durante ~30%→72% del clip.
  const draw = interpolate(frame, [Math.round(dur * 0.3), Math.round(dur * 0.72)], [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const pulse = interpolate(frame % Math.max(1, Math.round(fps * 1.8)), [0, Math.round(fps * 1.8)], [0, 1]);
  // Contorno SUAVE (el usuario: "muy recto, como contorneado por un niño"): path con curvas
  // cuadráticas por los puntos medios (suavizado clásico) en vez de polígono de rectas.
  const outlinePath = (() => {
    if (outline.length < 4) return '';
    const P = outline.map((p) => [p[0] * 100, p[1] * 100]);
    const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let d = `M ${mid(P[0], P[1])[0].toFixed(2)} ${mid(P[0], P[1])[1].toFixed(2)}`;
    for (let i = 1; i <= P.length; i++) {
      const cur = P[i % P.length];
      const nxt = P[(i + 1) % P.length];
      const m = mid(cur, nxt);
      d += ` Q ${cur[0].toFixed(2)} ${cur[1].toFixed(2)} ${m[0].toFixed(2)} ${m[1].toFixed(2)}`;
    }
    return d + ' Z';
  })();

  return (
    <AbsoluteFill style={{backgroundColor: '#eef3f8', overflow: 'hidden', fontFamily: th.font}}>
      {/* MAPA de RELIEVE: la cámara (zoom con origen en el target). Con CONTORNO usamos objectFit
          'fill' para que el borde GeoJSON (en 0..1) alinee EXACTO con el mapa equirectangular.
          En 'modern' el mapa lleva un grade oscuro desaturado (look nav/AE de la referencia). */}
      {src
        ? <Img src={src} style={{position: 'absolute', width: '100%', height: '100%',
            objectFit: outline.length ? 'fill' : 'cover',
            filter: modern ? 'grayscale(0.30) brightness(0.58) contrast(1.28) saturate(0.72)' : 'none',
            transform: `scale(${mapScale})`, transformOrigin: `${ox * 100}% ${oy * 100}%`}} />
        : <AbsoluteFill style={{background: 'radial-gradient(circle at 50% 45%, #16324a, #060b12)',
            transform: `scale(${mapScale})`, transformOrigin: `${ox * 100}% ${oy * 100}%`}} />}
      {/* Grade MODERNO: capa azul-noche multiplicada + realce frío → "neon-on-dark" */}
      {modern ? (
        <>
          <AbsoluteFill style={{background: '#12203a', mixBlendMode: 'multiply', opacity: 0.55}} />
          <AbsoluteFill style={{background: 'radial-gradient(circle at 50% 42%, rgba(56,140,255,0.10), rgba(0,0,0,0) 55%)'}} />
          <AbsoluteFill style={{background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 55%, rgba(2,6,14,0.7))'}} />
        </>
      ) : null}
      {/* CONTORNO del país (fronteras reales) trazándose en blanco, con la MISMA cámara que el mapa. */}
      {outlinePath ? (
        // Contorno SUAVE con FADE (opacidad+glow), sin dash+pathLength+non-scaling-stroke:
        // esa combinación tiene un bug de render en Chromium.
        <AbsoluteFill style={{transform: `scale(${mapScale})`, transformOrigin: `${ox * 100}% ${oy * 100}%`, opacity: draw}}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{width: '100%', height: '100%'}}>
            <path d={outlinePath} fill={modern ? `rgba(53,224,255,${0.05 * draw})` : `rgba(255,255,255,${0.10 * draw})`}
              stroke="rgba(0,0,0,0.4)" strokeWidth={1.0} vectorEffect="non-scaling-stroke" />
            <path d={outlinePath} fill="none" stroke={modern ? '#7fe9ff' : '#fff'} strokeWidth={1.7}
              vectorEffect="non-scaling-stroke" strokeLinejoin="round"
              style={{filter: `drop-shadow(0 0 ${2 + 4 * draw}px ${modern ? 'rgba(53,224,255,0.9)' : 'rgba(255,255,255,0.85)'})`}} />
          </svg>
        </AbsoluteFill>
      ) : null}
      {/* RUTA luminosa (estilo nav de la referencia): arco que se TRAZA del target al destino,
          cian con glow. Se dibuja por SLICE de puntos (robusto, sin trucos de dash). */}
      {rtx !== null && rty !== null ? (() => {
        const mx = (tx + rtx) / 2, my = (ty + rty) / 2;
        const ddx = rtx - tx, ddy = rty - ty;
        const lift = Math.min(0.18, Math.hypot(ddx, ddy) * 0.35);
        const cxp = mx - ddy * lift / Math.max(0.05, Math.hypot(ddx, ddy));
        const cyp = my + ddx * lift / Math.max(0.05, Math.hypot(ddx, ddy));
        const N = 80;
        const all: number[][] = [];
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          const x = (1 - t) * (1 - t) * tx + 2 * (1 - t) * t * cxp + t * t * rtx;
          const y = (1 - t) * (1 - t) * ty + 2 * (1 - t) * t * cyp + t * t * rty;
          all.push([x * 100, y * 100]);
        }
        const vis = all.slice(0, Math.max(2, Math.ceil(draw * all.length)));
        const ptsStr = vis.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
        const head = vis[vis.length - 1];
        return (
          <AbsoluteFill style={{transform: `scale(${mapScale})`, transformOrigin: `${ox * 100}% ${oy * 100}%`}}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{width: '100%', height: '100%'}}>
              <polyline points={ptsStr} fill="none" stroke={modern ? '#35e0ff' : accent} strokeWidth={2.6}
                vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"
                style={{filter: `drop-shadow(0 0 6px ${modern ? 'rgba(53,224,255,0.95)' : 'rgba(255,255,255,0.7)'})`}} />
              {/* cabeza del trazo: ELLIPSE con radios compensados (viewBox 100x100 sobre 16:9
                  estira la x → un circle saldría ovalado) */}
              {draw > 0.02 && draw < 0.995 ? <ellipse cx={head[0]} cy={head[1]} rx={0.34} ry={0.6}
                fill="#fff" style={{filter: `drop-shadow(0 0 5px ${modern ? '#35e0ff' : '#fff'})`}} /> : null}
            </svg>
          </AbsoluteFill>
        );
      })() : null}
      {/* Etiqueta del DESTINO de la ruta (pill moderna) cuando el trazo llega (draw>0.9) */}
      {rtx !== null && rty !== null && routeName ? (
        <div style={{position: 'absolute', left: `${scr(rtx as number, rty as number)[0] * 100}%`,
          top: `${scr(rtx as number, rty as number)[1] * 100}%`,
          opacity: interpolate(draw, [0.85, 1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
          <div style={{position: 'absolute', left: -7, top: -7, width: 14, height: 14, background: modern ? '#35e0ff' : accent,
            border: '2.5px solid #fff', borderRadius: '50%', boxShadow: `0 0 10px ${modern ? 'rgba(53,224,255,0.9)' : 'rgba(0,0,0,0.5)'}`}} />
          <div style={{position: 'absolute', left: 16, top: -46, padding: '8px 18px', borderRadius: 999,
            background: 'linear-gradient(135deg, rgba(8,14,24,0.92), rgba(8,14,24,0.72))',
            border: `1.5px solid ${modern ? '#35e0ff' : accent}`, color: '#fff', fontSize: 28, fontWeight: 700,
            fontFamily: 'Inter, Arial, sans-serif', whiteSpace: 'nowrap',
            boxShadow: `0 4px 18px rgba(0,0,0,0.5), 0 0 14px ${modern ? 'rgba(53,224,255,0.35)' : 'rgba(0,0,0,0)'}`}}>{routeName}</div>
        </div>
      ) : null}
      {/* NUBES en los bordes: MISMO origen que la cámara pero escalan MÁS (parallax). No se animan
          solas; la cámara las aparta. Siguen viéndose (cloudFade no baja de 0.5). */}
      <AbsoluteFill style={{transform: `scale(${cloudScale})`, transformOrigin: `${ox * 100}% ${oy * 100}%`,
        opacity: cloudFade * (modern ? 0.45 : 1)}}>
        {_CLOUD_LAYOUT.map((c, i) => (
          <Img key={i} src={staticFile(_CLOUD_SPRITES[c.sp])}
            style={{position: 'absolute', left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w}%`,
              transform: 'translate(-50%,-50%)', opacity: c.o}} />
        ))}
      </AbsoluteFill>
      {/* NUBES DE PANTALLA (referencia del usuario: "siempre se nota que son nubes"): capa
          FIJA en los bordes del encuadre que NO se aleja con la cámara — deriva lentísima
          lateral. Así al final no queda solo una viñeta blanca: se ven nubes de verdad. */}
      <AbsoluteFill style={{pointerEvents: 'none'}}>
        {[{x: -0.06, y: 0.1, w: 44, sp: 0, dx: 6}, {x: 1.04, y: 0.16, w: 46, sp: 2, dx: -7},
          {x: -0.04, y: 0.86, w: 48, sp: 3, dx: 5}, {x: 1.05, y: 0.9, w: 44, sp: 1, dx: -6},
          {x: 0.5, y: 1.06, w: 52, sp: 0, dx: 4}].map((c, i) => (
          <Img key={`sc${i}`} src={staticFile(_CLOUD_SPRITES[c.sp])}
            style={{position: 'absolute', left: `calc(${c.x * 100}% + ${cam * c.dx * 14}px)`,
              top: `${c.y * 100}%`, width: `${c.w}%`, transform: 'translate(-50%,-50%)',
              opacity: 0.9 * (modern ? 0.55 : 1)}} />
        ))}
      </AbsoluteFill>
      {/* halo atmosférico muy leve en el borde */}
      <AbsoluteFill style={{boxShadow: 'inset 0 0 240px 70px rgba(206,222,238,0.4)', pointerEvents: 'none'}} />
      {/* PIN + etiqueta elegante + BANDERA anclados a la POSICIÓN EN PANTALLA bajo la cámara
          (scr) — siguen pegados al terreno aunque el foco sea el punto medio de una ruta. */}
      <div style={{position: 'absolute', left: `${scr(tx, ty)[0] * 100}%`, top: `${scr(tx, ty)[1] * 100}%`, opacity: rev}}>
        {/* Anillo CONCÉNTRICO con el punto: centro en (0,0) del contenedor (el mismo ancla que
            el dot) + translate(-50%,-50%). (Antes tenía left/top:-11 ADEMÁS del translate →
            quedaba descentrado ~17px, medido por el revisor.) Arranca en 34px para no rozar el dot. */}
        <div style={{position: 'absolute', left: 0, top: 0, width: 34 + pulse * 92, height: 34 + pulse * 92,
          border: `3px solid ${accent}`, borderRadius: '50%', transform: 'translate(-50%,-50%)', opacity: (1 - pulse) * rev}} />
        <div style={{position: 'absolute', left: -10, top: -10, width: 20, height: 20, background: accent,
          border: '3px solid #fff', borderRadius: '50%', boxShadow: '0 3px 12px rgba(0,0,0,0.55)'}} />
        <svg width="60" height="70" style={{position: 'absolute', left: 2, top: -70, overflow: 'visible'}}>
          <path d="M2 68 L52 8" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity="0.95"
            style={{filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.6))'}} />
        </svg>
        <div style={{position: 'absolute', left: 52, top: -104, transform: `translateY(${(1 - rev) * 10}px)`,
          display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap'}}>
          {modern ? (
            <span style={{padding: '10px 22px', borderRadius: 999, fontSize: 40, fontWeight: 800,
              fontFamily: 'Inter, Arial, sans-serif', color: '#fff', letterSpacing: 0.3,
              background: 'linear-gradient(135deg, rgba(8,14,24,0.92), rgba(8,14,24,0.7))',
              border: '1.5px solid #35e0ff',
              boxShadow: '0 4px 20px rgba(0,0,0,0.55), 0 0 16px rgba(53,224,255,0.35)'}}>{label}</span>
          ) : (
            <span style={{fontSize: 54, fontWeight: 700, fontStyle: 'italic',
              fontFamily: 'Georgia, "Times New Roman", serif', color: '#fff',
              textShadow: '0 3px 20px rgba(0,0,0,0.85)', letterSpacing: 0.5}}>{label}</span>
          )}
          {flag ? <Img src={_mapSrc(flag)} style={{height: 48, borderRadius: 6,
            border: '1.5px solid rgba(255,255,255,0.85)',
            boxShadow: '0 3px 12px rgba(0,0,0,0.55)'}} /> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ESTILO VOX / AFTER EFFECTS (opt-in por canal: "Motion estilo After Effects").
// Réplica del vídeo de referencia (7wuYBfE131U) analizado frame a frame:
//  · Fondo PAPEL #D7D6CF con rejilla sutil, FIJO en todas las escenas (sensación
//    de plano continuo; lo que entra/sale son las capas).
//  · Recortes en halftone B/N (los prepara scripts/vox_assets.py) con TRAZO ROJO
//    desplazado (drop-shadow #D85030) — la firma visual del estilo.
//  · Naranja #F58509: barra inferior, subrayado marker, líneas de chart.
//  · Todo entra con spring ESCALONADO (nada se mueve a la vez).
// Estas escenas son FULLSCREEN a propósito (como el mapa): SOLO aparecen cuando
// el canal activa el estilo (PIPELINE_MOTION_STYLE=vox) — el modo natural
// documental ni las ve, así que no rompe los principios del set por defecto.
// ─────────────────────────────────────────────────────────────────────────────
const VOX = {
  paper: '#D7D6CF',
  card: '#F7F4EA',
  ink: '#141414',
  orange: '#F58509',
  stroke: '#D85030',
  trend: '#9A968C',
  grid: 'rgba(20,20,20,0.05)',
  label: "'Anton', 'Arial Black', sans-serif",
  small: "'Oswald', Inter, sans-serif",
};

// FONDOS ROTATIVOS (feedback del usuario: "no solo esta plantilla — otros fondos,
// negro para que se vean las personas delante, ir rotando para romper el patrón").
// Cada evento elige variante de forma DETERMINISTA (hash del id) → varía dentro
// del vídeo y entre vídeos; (event as any).voxBg lo fuerza desde el editor.
type VoxBg = {bg: string; grid: string; ink: string; sub: string; vig: string};
const VOX_BGS: Record<string, VoxBg> = {
  paper: {bg: '#D7D6CF', grid: 'rgba(20,20,20,0.05)', ink: '#141414', sub: '#4c483e',
          vig: 'radial-gradient(ellipse at 50% 42%, rgba(255,252,244,0.20), rgba(40,35,25,0.07) 92%)'},
  dark:  {bg: '#161513', grid: 'rgba(255,255,255,0.045)', ink: '#F2EFE6', sub: '#b9b4a6',
          vig: 'radial-gradient(ellipse at 50% 40%, rgba(255,245,225,0.06), rgba(0,0,0,0.35) 95%)'},
  cream: {bg: '#EAE4D3', grid: 'rgba(90,70,40,0.06)', ink: '#1d1a14', sub: '#5a5344',
          vig: 'radial-gradient(ellipse at 50% 42%, rgba(255,252,240,0.25), rgba(60,45,25,0.08) 92%)'},
};
const voxBgOf = (event: MotionEvent): VoxBg => {
  const forced = String((event as any).voxBg || '').toLowerCase().trim();
  if (VOX_BGS[forced]) return VOX_BGS[forced];
  const s = String(event.id || '') + String(event.title || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const keys = ['paper', 'dark', 'cream'];
  return VOX_BGS[keys[h % keys.length]];
};

const voxSpring = (frame: number, fps: number, delay = 0) =>
  spring({frame: Math.max(0, frame - delay), fps, config: {damping: 14, stiffness: 120, mass: 0.9}});

// Fondo (papel/negro/crema) + rejilla + viñeta. Sin barra inferior (al usuario
// no le gustaba). Deriva de cámara muy leve para que respire.
const VoxBackdrop: React.FC<{frame: number; fps: number; v: VoxBg; children?: React.ReactNode}> = ({frame, fps, v, children}) => {
  const drift = 1 + Math.min(0.018, frame / (fps * 60) * 0.02);
  return (
    <AbsoluteFill style={{background: v.bg, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          transform: `scale(${drift})`,
          backgroundImage:
            `repeating-linear-gradient(0deg, ${v.grid} 0 1px, transparent 1px 64px),` +
            `repeating-linear-gradient(90deg, ${v.grid} 0 1px, transparent 1px 64px)`,
        }}
      />
      <AbsoluteFill style={{background: v.vig}} />
      {children}
    </AbsoluteFill>
  );
};

// Iconos SVG DE VERDAD para el contador (el "barril" abstracto no parecía un
// barril). Se elige por palabras del subtítulo/título: barril, dinero, subida,
// salud, píldora, persona; fallback = cuadrado naranja con el símbolo del sufijo.
const VoxIcon: React.FC<{label: string; size?: number}> = ({label, size = 76}) => {
  const t = (label || '').toLowerCase();
  const S = size;
  const common = {width: S, height: S} as React.CSSProperties;
  if (/(barril|petr[oó]leo|oil|crudo|barrel)/.test(t)) {
    return (
      <svg viewBox="0 0 64 64" style={common}>
        <path d="M16 8 h32 c2 4 3 9 3 16 0 5-1 8-2 8 1 0 2 3 2 8 0 7-1 12-3 16 H16 c-2-4-3-9-3-16 0-5 1-8 2-8-1 0-2-3-2-8 0-7 1-12 3-16 Z" fill={VOX.orange} stroke="#141414" strokeWidth="3.4" strokeLinejoin="round" />
        <path d="M13.5 24 h37 M13.5 40 h37" stroke="#141414" strokeWidth="3.4" />
        <ellipse cx="32" cy="9.5" rx="16" ry="3.4" fill="#f9a53f" stroke="#141414" strokeWidth="3" />
      </svg>
    );
  }
  if (/(salud|coraz[oó]n|health|cardio|vida)/.test(t)) {
    return (
      <svg viewBox="0 0 64 64" style={common}>
        <path d="M32 54 C14 42 8 32 8 23 C8 15 14 10 21 10 C26 10 30 13 32 17 C34 13 38 10 43 10 C50 10 56 15 56 23 C56 32 50 42 32 54 Z" fill={VOX.orange} stroke="#141414" strokeWidth="3.4" strokeLinejoin="round" />
        <path d="M14 32 h10 l4-8 6 14 4-8 h12" fill="none" stroke="#141414" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }
  if (/(p[ií]ldora|pastilla|medicament|f[aá]rmaco|dosis)/.test(t)) {
    return (
      <svg viewBox="0 0 64 64" style={common}>
        <g transform="rotate(-38 32 32)">
          <rect x="12" y="22" width="40" height="20" rx="10" fill="#F2EFE6" stroke="#141414" strokeWidth="3.4" />
          <path d="M32 22 v20" stroke="#141414" strokeWidth="3.4" />
          <rect x="32" y="22" width="20" height="20" rx="10" fill={VOX.orange} stroke="#141414" strokeWidth="3.4" />
        </g>
      </svg>
    );
  }
  if (/(sube|subida|r[eé]cord|m[aá]ximo|crec|inflaci|aumento|alza)/.test(t)) {
    return (
      <svg viewBox="0 0 64 64" style={common}>
        <path d="M10 48 L26 32 L36 40 L54 20" fill="none" stroke={VOX.orange} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M40 18 h16 v16" fill="none" stroke="#141414" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (/(persona|gente|habitante|poblaci|muert|v[ií]ctima|people)/.test(t)) {
    return (
      <svg viewBox="0 0 64 64" style={common}>
        <circle cx="32" cy="18" r="10" fill={VOX.orange} stroke="#141414" strokeWidth="3.4" />
        <path d="M12 54 c0-12 9-19 20-19 s20 7 20 19" fill={VOX.orange} stroke="#141414" strokeWidth="3.4" strokeLinejoin="round" />
      </svg>
    );
  }
  if (/([$€£]|d[oó]lar|euro|dinero|coste|precio|mill[oó]n|deuda|billete)/.test(t)) {
    return (
      <svg viewBox="0 0 64 64" style={common}>
        <circle cx="32" cy="32" r="24" fill={VOX.orange} stroke="#141414" strokeWidth="3.6" />
        <text x="32" y="43" textAnchor="middle" fontFamily="'Arial Black', Arial" fontSize="30" fill="#141414">$</text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" style={common}>
      <rect x="10" y="10" width="44" height="44" rx="9" fill={VOX.orange} stroke="#141414" strokeWidth="3.6" />
      <circle cx="32" cy="32" r="9" fill="none" stroke="#141414" strokeWidth="4" />
    </svg>
  );
};

// Escena de RECORTES estilo collage editorial (v3, feedback: "más animado, como
// la referencia; solo una persona se vio simple"). Capas que entran ESCALONADAS:
// palabra GIGANTE desvanecida detrás → anillo naranja que SE DIBUJA alrededor del
// sujeto → recorte(s) con trazo rojo y parallax → chips de papel con palabras
// clave → marcas editoriales (+) → etiqueta con barrido marker. Todo en código,
// cero assets extra.
const VoxScene: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const v = voxBgOf(event);
  const dark = v === VOX_BGS.dark;
  const mid = (event.image || '').trim();
  const fg = (event.image2 || '').trim();
  const solo = !(mid && fg);                 // una sola imagen → PROTAGONISTA central
  const hero = mid || fg;
  const heroIsColor = !mid;                  // sin halftone → recorte a color
  const sM1 = voxSpring(frame, fps, 10);
  const sFg = voxSpring(frame, fps, 18);
  const sLb = voxSpring(frame, fps, 30);
  const label = clean(event.title);
  const drift = frame / fps;                 // parallax sutil entre capas

  // Palabra GIGANTE de fondo (1as palabras del título) — muy desvanecida, deriva.
  const bigWord = (label || '').split(/\s+/).slice(0, 2).join(' ').toUpperCase();
  const sBg = voxSpring(frame, fps, 2);

  // Anillo naranja "dibujado a mano" que rodea al sujeto (SVG, se traza en ~0.8s).
  const ringP = interpolate(frame, [Math.round(fps * 0.45), Math.round(fps * 1.25)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const RING_LEN = 2400;

  // Chips de papel: bullets reales del planner o, si no hay, el subtítulo entero.
  const chipTexts = (() => {
    const its = realItems(event).slice(0, 3).map((t) => shortCopy(t, 3, 22));
    if (its.length) return its;
    const sub = shortCopy(clean(event.subtitle || ''), 5, 34);
    return sub ? [sub] : [];
  })();
  const CHIP_POS = solo
    ? [{left: '14%', top: '24%', rot: -3.2}, {left: '72%', top: '30%', rot: 2.4}, {left: '69%', top: '62%', rot: -1.8}]
    : [{left: '8%', top: '20%', rot: -3.2}, {left: '78%', top: '24%', rot: 2.4}, {left: '6%', top: '58%', rot: -1.8}];

  // Marcas editoriales «+» que hacen pop (como anotaciones de redacción).
  const MARKS = [{left: '20%', top: '16%', d: 34}, {left: '84%', top: '48%', d: 44}, {left: '30%', top: '74%', d: 52}];

  const shadow = (s: number, w: string, left: string, bottom: string) => (
    <div style={{position: 'absolute', left, bottom, width: w, height: 26,
      transform: 'translateX(-50%)', background: 'radial-gradient(ellipse, rgba(0,0,0,0.30), transparent 70%)',
      opacity: 0.7 * Math.min(1, s * 1.4), filter: 'blur(6px)'}} />
  );
  const imgFilter = (color: boolean, redStroke: boolean) => {
    const parts = [];
    if (redStroke) parts.push(`drop-shadow(14px -8px 0 ${VOX.stroke})`);
    if (color && dark) parts.push('brightness(1.16)', 'drop-shadow(0 0 30px rgba(255,244,220,0.18))');
    parts.push(`drop-shadow(0 20px 28px rgba(0,0,0,${dark ? 0.5 : 0.24}))`);
    return parts.join(' ');
  };

  return (
    <VoxBackdrop frame={frame} fps={fps} v={v}>
      {/* 1 · palabra gigante detrás, derivando muy despacio */}
      {bigWord ? (
        <div style={{
          position: 'absolute', left: '50%', top: '9%', whiteSpace: 'nowrap',
          transform: `translateX(calc(-50% + ${(1 - sBg) * 60 - drift * 6}px))`,
          fontFamily: VOX.label, fontSize: 236, letterSpacing: 6, lineHeight: 1,
          color: v.ink, opacity: (dark ? 0.085 : 0.065) * Math.min(1, sBg * 2),
        }}>{bigWord}</div>
      ) : null}

      {/* 2 · anillo naranja que se dibuja alrededor del sujeto */}
      {hero ? (
        <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}>
          <ellipse
            cx={solo ? 960 : 1228} cy={solo ? 620 : 660} rx={360} ry={300}
            fill="none" stroke={VOX.orange} strokeWidth={6} strokeLinecap="round"
            transform={`rotate(-8 ${solo ? 960 : 1228} ${solo ? 620 : 660})`}
            strokeDasharray={RING_LEN}
            strokeDashoffset={RING_LEN * (1 - ringP)}
            opacity={0.85}
          />
        </svg>
      ) : null}

      {/* 3 · recortes con trazo rojo + parallax */}
      {solo && hero ? (
        <>
          {shadow(sM1, '34%', '50%', '11%')}
          <Img
            src={/^(https?:|data:)/.test(hero) ? hero : staticFile(hero)}
            style={{
              position: 'absolute', left: '50%', bottom: '12%', height: '64%',
              transform: `translateX(calc(-50% + ${drift * 3}px)) translateY(${(1 - sM1) * 70}px) scale(${0.78 + sM1 * 0.22})`,
              transformOrigin: 'bottom center',
              opacity: Math.min(1, sM1 * 1.4),
              filter: imgFilter(heroIsColor, true),
            }}
          />
        </>
      ) : (
        <>
          {mid ? (
            <Img
              src={/^(https?:|data:)/.test(mid) ? mid : staticFile(mid)}
              style={{
                position: 'absolute', left: '31%', bottom: '30%', height: '52%',
                transform: `translateX(calc(-50% + ${drift * 4}px)) translateY(${(1 - sM1) * 60}px) scale(${0.72 + sM1 * 0.28})`,
                transformOrigin: 'bottom center',
                opacity: Math.min(1, sM1 * 1.4),
                filter: imgFilter(false, true),
              }}
            />
          ) : null}
          {fg ? (
            <>
              {shadow(sFg, '30%', '64%', '9%')}
              <Img
                src={/^(https?:|data:)/.test(fg) ? fg : staticFile(fg)}
                style={{
                  position: 'absolute', left: '64%', bottom: '10%', height: '56%',
                  transform: `translateX(calc(-50% - ${drift * 5}px)) translateY(${(1 - sFg) * 90}px) scale(${0.8 + sFg * 0.2})`,
                  transformOrigin: 'bottom center',
                  opacity: Math.min(1, sFg * 1.5),
                  filter: imgFilter(true, false),
                }}
              />
            </>
          ) : null}
        </>
      )}

      {/* 4 · chips de papel con palabras clave, escalonados y con leve rotación */}
      {chipTexts.map((t, i) => {
        const s = voxSpring(frame, fps, 26 + i * 9);
        const p = CHIP_POS[i] || CHIP_POS[0];
        return (
          <div key={i} style={{
            position: 'absolute', left: p.left, top: p.top,
            transform: `rotate(${p.rot}deg) translateY(${(1 - s) * 30}px) scale(${0.86 + s * 0.14})`,
            opacity: Math.min(1, s * 1.5),
            background: '#FBF8F0', color: '#141414', borderRadius: 6,
            padding: '10px 16px', fontFamily: VOX.small, fontWeight: 800,
            fontSize: 24, letterSpacing: 1.2, textTransform: 'uppercase',
            boxShadow: `4px 6px 0 ${VOX.stroke}, 0 14px 24px rgba(0,0,0,0.22)`,
          }}>{t}</div>
        );
      })}

      {/* 5 · marcas editoriales «+» que hacen pop */}
      {MARKS.map((m, i) => {
        const s = voxSpring(frame, fps, m.d);
        return (
          <svg key={i} viewBox="0 0 24 24" style={{
            position: 'absolute', left: m.left, top: m.top, width: 26, height: 26,
            opacity: 0.75 * Math.min(1, s * 1.6), transform: `scale(${s}) rotate(${i % 2 ? 14 : -10}deg)`,
          }}>
            <path d="M12 3 v18 M3 12 h18" stroke={i === 1 ? VOX.orange : v.ink} strokeWidth={3.4} strokeLinecap="round" />
          </svg>
        );
      })}

      {/* 6 · etiqueta con barrido MARKER naranja (como el titular del periódico) */}
      {label ? (
        <div
          style={{
            position: 'absolute', left: PAD, bottom: 76, opacity: sLb,
            transform: `translateY(${(1 - sLb) * 18}px)`,
            fontFamily: VOX.small, fontWeight: 800, letterSpacing: 3,
            textTransform: 'uppercase', fontSize: 27, color: v.ink,
          }}
        >
          <span style={{
            backgroundImage: `linear-gradient(${VOX.orange}, ${VOX.orange})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${Math.round(interpolate(frame, [Math.round(fps * 1.1), Math.round(fps * 1.7)], [0, 100], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}))}% 42%`,
            backgroundPosition: '0 88%', padding: '0 6px 4px',
            color: dark ? '#F2EFE6' : v.ink,
          }}>
            {shortCopy(label, 6, 40)}
          </span>
        </div>
      ) : null}
    </VoxBackdrop>
  );
};

// PERIÓDICO construido 100% en código (masthead + titular con SUBRAYADO MARKER
// animado + columnas falsas). Nada de assets: es la escena tipográfica del estilo.
const VoxPaper: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = voxSpring(frame, fps, 0);
  const masthead = shortCopy(clean(event.kicker || '') || 'EL INFORME', 3, 22);
  const headline = shortCopy(clean(event.title), 10, 64) || 'Titular';
  // marker: resalta las 2 últimas palabras con un barrido naranja
  const words = headline.split(/\s+/);
  const cut = Math.max(1, words.length - 2);
  const head = words.slice(0, cut).join(' ');
  const marked = words.slice(cut).join(' ');
  const sweep = interpolate(frame, [Math.round(fps * 0.9), Math.round(fps * 1.5)], [0, 100], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const colLine = `repeating-linear-gradient(0deg, rgba(20,20,20,0.32) 0 3px, transparent 3px 11px)`;
  const v = voxBgOf(event);
  return (
    <VoxBackdrop frame={frame} fps={fps} v={v}>
      <div
        style={{
          position: 'absolute', left: '50%', top: '50%',
          width: '58%', padding: '38px 44px 44px',
          background: '#FBF8F0', borderRadius: 4,
          transform: `translate(-50%, -50%) rotate(-1.6deg) translateY(${(1 - s) * 120}px) scale(${0.9 + s * 0.1})`,
          opacity: Math.min(1, s * 1.4),
          boxShadow: '0 30px 60px rgba(0,0,0,0.28)',
          color: VOX.ink, fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div style={{textAlign: 'center', borderBottom: '3px solid #141414', paddingBottom: 10}}>
          <div style={{fontSize: 44, fontWeight: 900, letterSpacing: 1}}>{masthead}</div>
        </div>
        <div style={{borderBottom: '1px solid rgba(20,20,20,0.35)', height: 4, margin: '3px 0 22px'}} />
        <div style={{textAlign: 'center', fontSize: 52, lineHeight: 1.12, fontWeight: 800}}>
          {head}{' '}
          <span
            style={{
              backgroundImage: `linear-gradient(${VOX.orange}, ${VOX.orange})`,
              backgroundRepeat: 'no-repeat', backgroundSize: `${sweep}% 78%`,
              backgroundPosition: '0 62%', padding: '0 4px',
            }}
          >
            {marked}
          </span>
        </div>
        {event.subtitle ? (
          <div style={{textAlign: 'center', fontStyle: 'italic', fontSize: 21, marginTop: 14, opacity: 0.75}}>
            {shortCopy(clean(event.subtitle), 12, 78)}
          </div>
        ) : null}
        <div style={{display: 'flex', gap: 26, marginTop: 26}}>
          <div style={{flex: 1, height: 190, backgroundImage: colLine}} />
          <div style={{flex: 1, height: 190, backgroundImage: colLine}} />
          <div style={{flex: 1, height: 190, display: 'flex', flexDirection: 'column', gap: 10}}>
            <div style={{height: 96, background: '#1c1c1c'}} />
            <div style={{flex: 1, backgroundImage: colLine}} />
          </div>
        </div>
      </div>
    </VoxBackdrop>
  );
};

// CHART de línea que SE DIBUJA (naranja) contra la tendencia (gris), en tarjeta
// crema, con badge que hace pop al final. Datos: items "2020: 1.2" o curva demo.
const VoxChart: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const sCard = voxSpring(frame, fps, 0);
  const bars = chartBars(event);
  // Datos REALES solo si los items traían números de verdad (display != '');
  // el fallback de chartBars genera barras lineales que aquí quedan planas.
  const real = bars.filter((b) => b.display && Number.isFinite(b.value));
  const vals = real.length >= 3
    ? real.map((b) => b.value)
    : [2, 2.4, 2.1, 1.6, 4.6, 8.1, 4.4, 3.4, 4.1];   // curva con PICO (estilo CPI de la referencia)
  const labels = real.length >= 3 ? real.map((b) => b.label) : vals.map((_, i) => String(2016 + i));
  const maxV = Math.max(...vals, 1);
  const W = 1180, H = 560, padL = 90, padB = 74, padT = 84, padR = 60;
  const px = (i: number) => padL + (i / Math.max(1, vals.length - 1)) * (W - padL - padR);
  const py = (v: number) => padT + (1 - v / (maxV * 1.15)) * (H - padT - padB);
  const pts = vals.map((v, i) => `${px(i)},${py(v)}`).join(' ');
  const trendPts = vals.map((v, i) => `${px(i)},${py(Math.min(v, vals[0] + (i * (maxV * 0.35)) / vals.length))}`).join(' ');
  const totalLen = 2200;
  const drawn = interpolate(frame, [Math.round(fps * 0.5), Math.round(fps * 2.2)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const sBadge = voxSpring(frame, fps, Math.round(fps * 2.3));
  const badge = clean(event.subtitle || '');
  const v = voxBgOf(event);
  return (
    <VoxBackdrop frame={frame} fps={fps} v={v}>
      <div
        style={{
          position: 'absolute', left: '50%', top: '50%', width: W, height: H,
          transform: `translate(-50%, -50%) translateY(${(1 - sCard) * 90}px)`,
          opacity: Math.min(1, sCard * 1.4),
          background: VOX.card, borderRadius: 14,
          boxShadow: '0 26px 54px rgba(0,0,0,0.22)',
        }}
      >
        <div style={{position: 'absolute', left: 36, top: 26, fontFamily: VOX.small, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', fontSize: 24, color: VOX.ink}}>
          {shortCopy(clean(event.title), 6, 40) || 'EVOLUCIÓN'}
        </div>
        <div style={{position: 'absolute', right: 36, top: 30, fontFamily: VOX.small, fontSize: 16, color: '#6d695f', display: 'flex', gap: 18, alignItems: 'center'}}>
          <span><span style={{display: 'inline-block', width: 26, height: 4, background: VOX.orange, marginRight: 7, verticalAlign: 'middle'}} />SERIE</span>
          <span><span style={{display: 'inline-block', width: 26, height: 4, background: VOX.trend, marginRight: 7, verticalAlign: 'middle'}} />TENDENCIA</span>
        </div>
        <svg width={W} height={H} style={{position: 'absolute', inset: 0}}>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={padL} x2={W - padR} y1={py(maxV * f)} y2={py(maxV * f)} stroke="rgba(20,20,20,0.08)" strokeWidth={1} />
          ))}
          <polyline points={trendPts} fill="none" stroke={VOX.trend} strokeWidth={4}
            strokeDasharray={totalLen} strokeDashoffset={totalLen * (1 - Math.min(1, drawn * 1.15))} />
          <polyline points={pts} fill="none" stroke={VOX.orange} strokeWidth={6} strokeLinejoin="round"
            strokeDasharray={totalLen} strokeDashoffset={totalLen * (1 - drawn)} />
          {vals.map((v, i) => {
            const on = drawn >= i / Math.max(1, vals.length - 1);
            return on ? <circle key={i} cx={px(i)} cy={py(v)} r={7} fill="#fff" stroke={VOX.orange} strokeWidth={4} /> : null;
          })}
        </svg>
        <div style={{position: 'absolute', left: padL, right: padR, bottom: 26, display: 'flex', justifyContent: 'space-between', fontFamily: VOX.small, fontSize: 15, color: '#6d695f'}}>
          {labels.map((l, i) => (<span key={i}>{shortCopy(String(l), 1, 8)}</span>))}
        </div>
        {badge ? (
          <div
            style={{
              position: 'absolute', right: 76, top: 108,
              transform: `scale(${sBadge})`, transformOrigin: 'center',
              background: '#fff', border: `3px solid ${VOX.orange}`, borderRadius: 10,
              padding: '10px 16px', fontFamily: VOX.label, fontSize: 26, color: VOX.ink,
              boxShadow: '0 10px 22px rgba(0,0,0,0.18)',
            }}
          >
            {shortCopy(badge, 4, 22)}
          </div>
        ) : null}
      </div>
    </VoxBackdrop>
  );
};

// CONTADOR grande estilo "$116 / PER BARREL": cifra negra enorme con count-up
// ANCLADO a la voz (el builder ancla el start como en stat_big), icono naranja
// y recorte opcional (barco, mapa, objeto) que entra por la izquierda.
const VoxCounter: React.FC<{event: MotionEvent}> = ({event}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const big = pickBig(event);
  const sIn = voxSpring(frame, fps, 0);
  const sImg = voxSpring(frame, fps, 6);
  const countDur = Math.round(fps * 0.7);
  const p = interpolate(frame, [Math.round(fps * 0.15), Math.round(fps * 0.15) + countDur], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const eased = 1 - Math.pow(1 - p, 3);
  const shown = big.isNumeric
    ? fmtNum(big.target * eased, decimalsOf(big.target), localeOf(event)) + (big.suffix || '')
    : big.value;
  const img = (event.image || '').trim();
  const label = shortCopy(clean(event.subtitle || ''), 4, 26);
  const v = voxBgOf(event);
  const dark = v === VOX_BGS.dark;
  return (
    <VoxBackdrop frame={frame} fps={fps} v={v}>
      {img ? (
        <Img
          src={/^(https?:|data:)/.test(img) ? img : staticFile(img)}
          style={{
            position: 'absolute', left: '6%', bottom: '10%', height: '56%',
            transform: `translateX(${(1 - sImg) * -120}px)`,
            opacity: Math.min(1, sImg * 1.4),
            // en fondo oscuro un recorte a color se funde → brillo leve + halo cálido
            filter: dark
              ? 'brightness(1.16) drop-shadow(0 0 30px rgba(255,244,220,0.18)) drop-shadow(0 20px 28px rgba(0,0,0,0.45))'
              : 'drop-shadow(0 20px 28px rgba(0,0,0,0.25))',
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute', right: '7%', top: '18%', textAlign: 'left',
          opacity: Math.min(1, sIn * 1.4), transform: `translateY(${(1 - sIn) * 40}px)`,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 24}}>
          <VoxIcon label={`${event.subtitle || ''} ${event.title || ''}`} size={96} />
          <div style={{fontFamily: VOX.label, fontSize: 120, lineHeight: 1, color: v.ink, letterSpacing: -2}}>
            {shown}
          </div>
        </div>
        {label ? (
          <div style={{marginTop: 10, marginLeft: 120, fontFamily: VOX.small, fontWeight: 800, letterSpacing: 4, textTransform: 'uppercase', fontSize: 26, color: v.sub}}>
            {label}
          </div>
        ) : null}
      </div>
    </VoxBackdrop>
  );
};

const renderEvent = (event: MotionEvent) => {
  const type = event.type || 'lower_third';
  // Composiciones editoriales observadas en la auditoría Vidrush. Se despachan
  // antes de los fallbacks históricos para que no se degraden a una tarjeta o
  // a un lower-third cuando el planner ha pedido una acción visual concreta.
  if (isVidrushType(type)) return <VidrushMotion event={event} />;
  // OVERLAYS EDITORIALES documentales (documentary-motion.tsx, 2026-09-05): calcados de las
  // referencias (Eli Yoder / American Secrets). Tipos propios + en DOCUMENTAL (docStyle,
  // sellado por remotion_graphics) los genéricos se visten igual: stat_big → cifra enorme
  // blanca centrada, section_title → título con eco, lower_third → etiqueta de papel.
  if (isDocumentaryType(type)) return <DocumentaryMotion event={event} />;
  if ((event as any).docStyle) {
    if (type === 'stat_big' || type === 'big_stat' || type === 'hero_stat' || type === 'big_date') {
      return <DocumentaryMotion event={{...event, type: 'big_stat_doc'}} />;
    }
    // Capítulos: barra inferior tipo "HEAT PIPE THEORY AND PRACTICE" (el usuario 2026-09-05
    // prefiere este formato al eco; el eco sigue disponible como plantilla explícita).
    if (type === 'section_title' || type === 'title_full') {
      return <DocumentaryMotion event={{...event, type: 'caption_bar'}} />;
    }
    if (type === 'lower_third') return <DocumentaryMotion event={{...event, type: 'paper_tag'}} />;
  }
  // ESTILO VOX (opt-in por canal): escenas fullscreen de papel — van primero.
  if (type === 'vox_scene') return <VoxScene event={event} />;
  if (type === 'vox_paper') return <VoxPaper event={event} />;
  // vox_chart SOLO con datos REALES (misma regla que `chart`): VoxChart tiene un fallback de
  // curva de ejemplo (2016-2024 inventados) para su demo, y el planner puede pedir motion=chart
  // sin items numéricos → se colaba una tendencia FABRICADA. Sin ≥3 puntos reales cae a los
  // overlays normales de abajo. Cero datos inventados en pantalla.
  if (type === 'vox_chart' && chartBarsReal(event).length >= 3) return <VoxChart event={event} />;
  if (type === 'vox_counter') return <VoxCounter event={event} />;
  // MAPA VECTORIAL (d3-geo/world-atlas): si el evento trae datos geográficos reales
  // (país a enfocar, países a teñir, ruta o marcadores por lon/lat) se usa GeoMap —
  // formas reales de países + cámara continua estilo Vox. Sin datos geo, cae al mapa
  // ráster de siempre (CloudMapZoom/MapRoute).
  const _hasGeo = !!(event.focusName || (event.highlight && event.highlight.length)
    || event.geoRoute || (event.markers && event.markers.length));
  // DOS ESTILOS QUE ROTAN (2026-07-17, el usuario: "este simple y minimalista que ya me gusta,
  // pero también … para rotar, ese que se ve más moderno, con las nubes"). La rotación la decide
  // Python (determinista por vídeo, MOTION_MAP_STYLE=auto|vector|clouds). Aquí SOLO se obedece:
  // 'clouds' CON ráster preparado → CloudMapZoom; en cualquier otro caso manda el vectorial
  // aprobado → un evento antiguo (mapStyle 'modern'/'natural'/vacío) con datos geo sigue saliendo
  // EXACTAMENTE igual que hoy, y si el ráster no se pudo preparar tampoco se degrada.
  const _wantsClouds = /^clouds?$/.test(String(event.mapStyle || '').toLowerCase())
    && !!String(event.image || '').trim();
  if (type === 'geo_map' || ((type === 'map_zoom' || type === 'map_route' || type === 'map'
      || type === 'map_callout' || type === 'cloud_map' || type === 'map_descend')
      && _hasGeo && !_wantsClouds)) {
    return <GeoMap event={{
      focusName: event.focusName, highlight: event.highlight, markers: event.markers,
      route: event.geoRoute, locName: event.locName || event.title, duration: event.duration,
      // acento del vídeo (mismo que el resto de overlays) → país/pin/ruta en color coherente.
      accent: event.accent || themeOf(event).accent,
    }} />;
  }
  if (type === 'map_zoom' || type === 'cloud_map' || type === 'map_descend') return <CloudMapZoom event={event} />;
  if (type === 'transition') return <Transition event={event} />;
  if (type === 'film_burn' || type === 'section_flash') return <FilmBurn event={event} />;
  if (type === 'map_route' || type === 'map_callout' || type === 'map') return <MapRoute event={event} />;
  // Esquemas Constructum/VidRush: se dibujan con la geometría que MiniMax escogió, no como
  // un panel de bullets. `map_route` mantiene su mapa geográfico; `site_plan` es el plano urbano.
  if (type === 'engineering_schematic' || type === 'site_plan' || type === 'structure_compare'
      || type === 'process_flow' || type === 'timeline') {
    return <EngineeringSchematic event={event} />;
  }
  // ESQUEMA en CORTE (cutaway/blueprint) — túnel, búnker, capas del subsuelo, sección de
  // infraestructura. La "esquema" firma de Beyond Military; el planner la pide para escenas
  // de construcción/profundidad/interior enterrado.
  if (type === 'cross_section' || type === 'cutaway' || type === 'blueprint'
      || type === 'depth_section' || type === 'tunnel_section' || type === 'schematic') {
    return <CrossSection event={event} />;
  }
  // PIRÁMIDE / JERARQUÍA (niveles anidados: líder→base, rangos, tiers). ANTES de los fallbacks
  // genéricos (SpecPanel/LowerThird). Necesita ≥2 niveles reales; si no, cae a los fallbacks.
  if ((type === 'pyramid' || type === 'hierarchy' || type === 'tiers'
      || type === 'org_chart' || type === 'pyramid_diagram') && realItems(event).length >= 2) {
    return <Pyramid event={event} />;
  }
  const hasItems = realItems(event).length >= 2;
  const hasNum = pickStat(event) !== null;

  // NARRATIVE TEXT — frase destacada con palabras clave resaltadas (estilo Firearms Vault).
  if (type === 'narrative_text') return <NarrativeText event={event} />;
  // BIG CENTER STAT/DATE — número/fecha grande centrado (intro, momento clave).
  if (type === 'stat_big' || type === 'big_stat' || type === 'big_date' || type === 'hero_stat') {
    return <BigStat event={event} />;
  }
  // CHART de barras animada (crecimiento/cantidades/comparación numérica). SOLO con ≥2
  // cantidades REALES del guion; si no, se cae a los fallbacks de abajo (rótulo/panel) —
  // nunca una gráfica con datos de ejemplo.
  if (type === 'chart' || type === 'bar_chart' || type === 'graph') {
    const real = chartBarsReal(event);
    // SERIE TEMPORAL (años) con ≥3 puntos → línea de tendencia que se dibuja; si no, barras.
    // La forma la decide el DATO (chartKind lo sella _chart_window en Python); los datos son
    // los mismos y ambas caen a los fallbacks si no hay cantidades reales que enseñar.
    if (event.chartKind === 'line' && real.length >= 3) return <LineChart event={event} />;
    if (real.length >= 2) return <Chart event={event} />;
  }
  // Ranking real
  if (type === 'ranking_card' || type === 'ae_documentary_rank' || (event.rank && event.rank > 0)) {
    return <Ranking event={event} />;
  }
  // Títulos de sección
  if (type === 'title_full' || type === 'ae_depth_title' || type === 'section_title') {
    return <SectionTitle event={event} />;
  }
  // Cifras / stats
  if ((type === 'stat_wall' || type === 'big_word' || type === 'number_badge' || type === 'ae_specs_plate' || type === 'ae_data_orbit') && hasNum) {
    return <Stat event={event} />;
  }
  // Paneles con bullets reales (specs, listas, comparativas). stat_wall SIN número
  // pero CON bullets = panel de specs (p.ej. "Equipamiento del túnel": riel/moto/
  // ventilación) — sin esto caía a LowerThird y los bullets se perdían.
  if (hasItems && (type === 'keyword_card' || type === 'checklist' || type === 'process_flow' || type === 'evidence_card' || type === 'split_panel' || type === 'timeline' || type === 'spec_panel' || type === 'stat_wall' || type.startsWith('ae_'))) {
    return <SpecPanel event={event} />;
  }
  // Por defecto: etiqueta lower-third (limpia, sobre el metraje)
  return <LowerThird event={event} />;
};

export const PipelineMotion: React.FC<PipelineMotionProps> = ({videoSrc, events, style}) => {
  const {fps} = useVideoConfig();
  const source = videoSrc && /^(https?:|file:|data:)/.test(videoSrc) ? videoSrc : staticFile(videoSrc || 'source.mp4');
  return (
    <AbsoluteFill style={{background: '#050607', color: 'white', fontFamily: 'Inter, Arial, sans-serif'}}>
      {/* delayRenderTimeout ALTO (2026-08-05): el "delayRender not cleared after 28000ms" (Managua)
          era el fetch del vídeo fuente PESADO (14-16 GB) que no llegaba en los 28s por defecto. Con
          la fuente ya ligera (cap de bitrate) casi no pasa, pero 180s de margen lo blinda del todo. */}
      <OffthreadVideo src={source} delayRenderTimeoutInMilliseconds={180000} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      {/* Viñeteado MUY sutil para legibilidad del texto, sin atenuar el metraje. */}
      <AbsoluteFill
        style={{
          background: 'linear-gradient(0deg, rgba(0,0,0,0.16), rgba(0,0,0,0) 38%)',
        }}
      />
      {events.map((event) => {
        const from = Math.max(0, Math.floor(event.start * fps));
        const durationInFrames = Math.max(1, Math.ceil(event.duration * fps) + 2);
        const localEvent = {...event, start: 0};
        return (
          <Sequence key={event.id} from={from} durationInFrames={durationInFrames}>
            {renderEvent(localEvent)}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
