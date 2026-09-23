import React, {type CSSProperties} from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

/**
 * Vidrush visual grammar
 *
 * This is deliberately not a set of interchangeable text cards. Each intent is
 * a small editorial composition with a job: show evidence, compare a dossier,
 * identify a person, inspect a mechanism, explain a physical system, or
 * introduce a field expert. The planner supplies the evidence and the intent;
 * it may not ask for an arbitrary decorative "preset".
 */
export const VIDRUSH_TYPES = [
  'vidrush_evidence_matrix',
  'vidrush_dossier_compare',
  'vidrush_identity_cutout',
  'vidrush_inspector_lens',
  'vidrush_cross_section',
  'vidrush_field_profile',
  'vidrush_archive_date',
  'vidrush_evidence_gallery',
] as const;

export type VidrushType = (typeof VIDRUSH_TYPES)[number];

export type VidrushMotionEvent = {
  id?: string;
  type?: string;
  title?: string;
  subtitle?: string;
  kicker?: string;
  items?: string[];
  image?: string;
  image2?: string;
  objectHint?: string;
  accent?: string;
  side?: 'left' | 'right' | 'center';
  duration?: number;
  /**
   * Optional normalized target point for inspector_lens. It deliberately has
   * no default in the plan writer: a lens must be tied to a real detail.
   */
  targetX?: number;
  targetY?: number;
  /** Idioma del vídeo (es/en/pt/fr/it/de): los rótulos fijos se traducen. */
  lang?: string;
};

// Rótulos FIJOS de las composiciones en el idioma del vídeo (2026-09-05: antes había fallbacks
// en inglés hardcodeados — "FOUNDING PARTNERS", "CASE FILE" — en vídeos en español).
const LBL = (lang?: string) => {
  const l = String(lang || 'es').slice(0, 2).toLowerCase();
  const d: Record<string, Record<string, string>> = {
    es: {archive: 'ARCHIVO / CONTEXTO', ev1: 'EVIDENCIA 01', ev2: 'EVIDENCIA 02', evn: 'EVIDENCIA', detail: 'DETALLE / INSPECCIÓN', profile: 'FICHA / PERFIL', dossier: 'EXPEDIENTE / VERSIONES', doc: 'DOCUMENTO', v1: 'VERSIÓN 01', v2: 'VERSIÓN 02', section: 'SISTEMA FÍSICO / CORTE', person: 'PERFIL', date: 'ARCHIVO'},
    en: {archive: 'ARCHIVE / CONTEXT', ev1: 'EVIDENCE 01', ev2: 'EVIDENCE 02', evn: 'EVIDENCE', detail: 'DETAIL / INSPECTION', profile: 'FIELD NOTE / PROFILE', dossier: 'CASE FILE / VERSIONS', doc: 'DOCUMENT', v1: 'VERSION 01', v2: 'VERSION 02', section: 'PHYSICAL SYSTEM / SECTION', person: 'PROFILE', date: 'ARCHIVE'},
    pt: {archive: 'ARQUIVO / CONTEXTO', ev1: 'EVIDÊNCIA 01', ev2: 'EVIDÊNCIA 02', evn: 'EVIDÊNCIA', detail: 'DETALHE / INSPEÇÃO', profile: 'FICHA / PERFIL', dossier: 'DOSSIÊ / VERSÕES', doc: 'DOCUMENTO', v1: 'VERSÃO 01', v2: 'VERSÃO 02', section: 'SISTEMA FÍSICO / CORTE', person: 'PERFIL', date: 'ARQUIVO'},
    fr: {archive: 'ARCHIVE / CONTEXTE', ev1: 'PREUVE 01', ev2: 'PREUVE 02', evn: 'PREUVE', detail: 'DÉTAIL / INSPECTION', profile: 'FICHE / PROFIL', dossier: 'DOSSIER / VERSIONS', doc: 'DOCUMENT', v1: 'VERSION 01', v2: 'VERSION 02', section: 'SYSTÈME PHYSIQUE / COUPE', person: 'PROFIL', date: 'ARCHIVE'},
    it: {archive: 'ARCHIVIO / CONTESTO', ev1: 'PROVA 01', ev2: 'PROVA 02', evn: 'PROVA', detail: 'DETTAGLIO / ISPEZIONE', profile: 'SCHEDA / PROFILO', dossier: 'FASCICOLO / VERSIONI', doc: 'DOCUMENTO', v1: 'VERSIONE 01', v2: 'VERSIONE 02', section: 'SISTEMA FISICO / SEZIONE', person: 'PROFILO', date: 'ARCHIVIO'},
    de: {archive: 'ARCHIV / KONTEXT', ev1: 'BEWEIS 01', ev2: 'BEWEIS 02', evn: 'BEWEIS', detail: 'DETAIL / INSPEKTION', profile: 'STECKBRIEF / PROFIL', dossier: 'AKTE / VERSIONEN', doc: 'DOKUMENT', v1: 'VERSION 01', v2: 'VERSION 02', section: 'PHYSISCHES SYSTEM / SCHNITT', person: 'PROFIL', date: 'ARCHIV'},
  };
  return d[l] || d.en;
};

// The production primitive never falls back to a reference/lab asset. Staging
// rejects an editorial event without a real scene asset; this transparent value
// only keeps manual Studio experimentation from importing an unrelated image.
const EMPTY_MEDIA = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/%3E';
const FALLBACK = {
  archiveA: EMPTY_MEDIA, archiveB: EMPTY_MEDIA, dossier: EMPTY_MEDIA,
  identity: EMPTY_MEDIA, inspection: EMPTY_MEDIA, profile: EMPTY_MEDIA,
};

const FONT = {
  condensed: "'BarlowCondensed', 'Arial Narrow', Arial, sans-serif",
  display: "'ArchivoBlack', 'Arial Black', Impact, sans-serif",
  serif: "'PlayfairDisplay', Georgia, serif",
  typewriter: "'Courier New', Courier, monospace",
};

const safeText = (value?: string, fallback = '') => String(value || fallback)
  .replace(/\s+/g, ' ')
  .trim();

const media = (value: string) => /^(https?:|data:)/i.test(value) ? value : staticFile(value);

/** PANTALLA COMPLETA (el usuario 2026-09-05: "recuerda que debe ser pantalla completa, si no se ve
 * raro"): detrás de cualquier composición con tarjetas va la propia foto de la escena a sangre,
 * desenfocada y oscurecida — nunca un fondo negro/crema plano con una foto pequeña en medio. */
const Backdrop: React.FC<{src?: string; dim?: number; blur?: number}> = ({src, dim = 0.58, blur = 22}) => (
  src && src !== EMPTY_MEDIA ? (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Img src={media(src)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.12)', filter: `blur(${blur}px) brightness(${1 - dim}) saturate(0.7)`}} />
    </AbsoluteFill>
  ) : null
);

const useSceneMotion = (duration?: number) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const end = Math.max(18, Math.min(durationInFrames - 1, Math.round((duration || durationInFrames / fps) * fps)));
  const enter = spring({
    frame,
    fps,
    config: {damping: 18, stiffness: 145, mass: 0.72},
    durationInFrames: Math.min(18, Math.max(10, Math.round(fps * 0.55))),
  });
  const opacity = interpolate(frame, [0, 6, end - 8, end], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return {frame, fps, enter, opacity, end};
};

const Grid: React.FC<{color?: string; opacity?: number}> = ({color = '#ffffff', opacity = 0.1}) => (
  <AbsoluteFill
    style={{
      opacity,
      backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
      backgroundSize: '52px 52px',
      maskImage: 'linear-gradient(90deg, transparent, black 16%, black 84%, transparent)',
    }}
  />
);

const Label: React.FC<{children: React.ReactNode; accent: string; style?: CSSProperties}> = ({children, accent, style}) => (
  <div
    style={{
      fontFamily: FONT.condensed,
      fontWeight: 800,
      fontSize: 17,
      lineHeight: 1,
      letterSpacing: 2.1,
      textTransform: 'uppercase',
      color: '#10100e',
      background: accent,
      padding: '8px 11px 7px',
      display: 'inline-block',
      ...style,
    }}
  >
    {children}
  </div>
);

const TypeBuild: React.FC<{text: string; start: number; speed?: number; style?: CSSProperties}> = ({text, start, speed = 3, style}) => {
  const frame = useCurrentFrame();
  const words = safeText(text).split(' ').filter(Boolean);
  return (
    <span style={style}>
      {words.map((word, index) => {
        const p = interpolate(frame, [start + index * speed, start + index * speed + 5], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
        });
        return <span key={`${word}-${index}`} style={{display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * 11}px)`, marginRight: '0.28em'}}>{word}</span>;
      })}
    </span>
  );
};

const Card: React.FC<{
  src: string;
  label: string;
  accent: string;
  style: CSSProperties;
  opacity: number;
  scale: number;
}> = ({src, label, accent, style, opacity, scale}) => (
  <div style={{position: 'absolute', opacity, transformOrigin: 'center', ...style, transform: `${style.transform || ''} scale(${scale})`}}>
    <div style={{background: '#f5f1e8', padding: 7, boxShadow: '0 18px 36px rgba(0,0,0,0.36)'}}>
      <Img src={media(src)} style={{display: 'block', width: '100%', height: '100%', objectFit: 'cover', filter: 'contrast(1.06) saturate(0.78)'}} />
    </div>
    <Label accent={accent} style={{position: 'absolute', left: 14, bottom: -15, whiteSpace: 'nowrap'}}>{label}</Label>
  </div>
);

/** Two pieces of evidence actively assemble into a comparative context. */
export const EvidenceMatrix: React.FC<{event: VidrushMotionEvent}> = ({event}) => {
  const {frame, enter, opacity} = useSceneMotion(event.duration);
  const L = LBL(event.lang);
  const accent = event.accent || '#e07a2f';
  const a = spring({frame: Math.max(0, frame - 2), fps: 30, config: {damping: 15, stiffness: 130, mass: 0.78}});
  const b = spring({frame: Math.max(0, frame - 10), fps: 30, config: {damping: 16, stiffness: 125, mass: 0.8}});
  const c1x = interpolate(a, [0, 1], [-160, 0]);
  const c2x = interpolate(b, [0, 1], [160, 0]);
  // Referencia Eli Yoder "SUMMER VS WINTER | 10 FT: STEADY COOL": dos fotos en marco blanco
  // sobre rejilla oscura, etiqueta de acento DEBAJO de cada foto. Sin lavado de color al salir
  // (el usuario 2026-09-05 lo vio como "colores raros"): solo fade.
  const its = (event.items || []).map((s) => safeText(s)).filter(Boolean);
  const lab1 = event.kicker || its[0] || L.ev1;
  const lab2 = event.subtitle || its[1] || L.ev2;
  return (
    <AbsoluteFill style={{background: '#141414', opacity}}>
      <Backdrop src={event.image} />
      <Grid color="#ded7c9" opacity={0.12} />
      <div style={{position: 'absolute', left: 72, top: 55, color: '#f5f1e8', fontFamily: FONT.condensed, fontWeight: 700, letterSpacing: 3, fontSize: 16}}>{L.archive}</div>
      {[{src: event.image || FALLBACK.archiveA, v: a, x: c1x, left: '12%', rot: -1.5, lab: lab1},
        {src: event.image2 || FALLBACK.archiveB, v: b, x: c2x, left: '53%', rot: 1.5, lab: lab2}].map((c, k) => (
        <div key={k} style={{position: 'absolute', left: c.left, top: '20%', width: '35%', opacity: Math.min(1, c.v * 1.45), transform: `translateX(${c.x}px) rotate(${c.rot}deg) scale(${0.9 + c.v * 0.1})`}}>
          <div style={{background: '#f5f1e8', padding: 8, boxShadow: '0 18px 40px rgba(0,0,0,0.5)'}}>
            <Img src={media(c.src)} style={{display: 'block', width: '100%', aspectRatio: '16/10', objectFit: 'cover', filter: 'contrast(1.06) saturate(0.85)'}} />
          </div>
          <div style={{marginTop: 18, textAlign: 'center'}}>
            <Label accent={accent} style={{fontSize: 19, padding: '9px 14px 8px'}}>{c.lab}</Label>
          </div>
        </div>
      ))}
      <div style={{position: 'absolute', left: 76, bottom: 52, maxWidth: 900, color: '#fbf9f3', fontFamily: FONT.serif, fontSize: 36, lineHeight: 1.16, opacity: Math.min(1, enter * 1.4)}}>
        {safeText(event.title)}
      </div>
    </AbsoluteFill>
  );
};

/** A document comparison; labels and redactions belong to the documents, never a generic HUD. */
export const DossierCompare: React.FC<{event: VidrushMotionEvent}> = ({event}) => {
  const {frame, opacity} = useSceneMotion(event.duration);
  const accent = event.accent || '#c89a45';
  const left = spring({frame: Math.max(0, frame - 4), fps: 30, config: {damping: 17, stiffness: 135, mass: 0.72}});
  const right = spring({frame: Math.max(0, frame - 13), fps: 30, config: {damping: 17, stiffness: 135, mass: 0.72}});
  const redaction = interpolate(frame, [38, 60], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const L = LBL(event.lang);
  const sub = safeText(event.subtitle, L.v2);
  const docs = (event.items || []).map((s) => safeText(s)).filter(Boolean);
  return (
    <AbsoluteFill style={{background: '#0d1010', opacity}}>
      <Img src={media(event.image || FALLBACK.dossier)} style={{width: '100%', height: '100%', objectFit: 'cover', opacity: 0.18, filter: 'grayscale(1) contrast(1.25)'}} />
      <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(5,7,7,.94), rgba(7,10,10,.68), rgba(5,7,7,.94))'}} />
      <Grid color="#dfd9c9" opacity={0.075} />
      <div style={{position: 'absolute', left: 68, top: 48, color: accent, fontFamily: FONT.condensed, fontSize: 16, fontWeight: 800, letterSpacing: 3.2}}>{L.dossier}</div>
      {[{tag: event.kicker || L.v1, value: left, x: '14%'}, {tag: sub, value: right, x: '55%'}].map((doc, index) => (
        <div key={doc.tag} style={{position: 'absolute', left: doc.x, top: '20%', width: '31%', height: '59%', opacity: Math.min(1, doc.value * 1.25), transform: `translateY(${(1 - doc.value) * 90}px) rotate(${index === 0 ? -1 : 1}deg)`, background: '#e7e1d3', color: '#1a1a18', boxShadow: '0 22px 50px rgba(0,0,0,.35)', padding: '32px 31px'}}>
          <div style={{fontFamily: FONT.typewriter, fontSize: 14, letterSpacing: 1.1, opacity: .72}}>{L.doc} / {index === 0 ? '01' : '02'}</div>
          <div style={{height: 1, background: '#262522', margin: '18px 0 26px'}} />
          <div style={{fontFamily: FONT.serif, fontSize: 31, lineHeight: 1.12}}>{docs[index] || safeText(event.title)}</div>
          {[0, 1, 2, 3].map((line) => <div key={line} style={{height: 7, marginTop: 17, width: `${[92, 78, 96, 62][line]}%`, background: 'rgba(25,25,22,.20)'}} />)}
          <div style={{position: 'absolute', left: 30, right: 42, top: 166, height: 24, background: '#11110f', transform: `scaleX(${redaction})`, transformOrigin: 'left'}} />
          <Label accent={accent} style={{position: 'absolute', left: 24, bottom: 22, fontSize: 13}}>{doc.tag}</Label>
        </div>
      ))}
      <div style={{position: 'absolute', left: '48.6%', top: '30%', height: '42%', width: 1, background: accent, opacity: Math.min(left, right) * .85}} />
      <div style={{position: 'absolute', left: '50%', bottom: 43, transform: 'translateX(-50%)', color: '#f3ede1', fontFamily: FONT.serif, fontSize: 29, textAlign: 'center'}}>
        <TypeBuild text={safeText(event.title)} start={36} speed={4} />
      </div>
    </AbsoluteFill>
  );
};

/** A person is introduced as an editorial subject, with an offset colour silhouette and typed name. */
export const IdentityCutout: React.FC<{event: VidrushMotionEvent}> = ({event}) => {
  const {frame, enter, opacity} = useSceneMotion(event.duration);
  const accent = event.accent || '#ee2b70';
  const name = safeText(event.title);
  const rise = interpolate(enter, [0, 1], [85, 0]);
  const shadow = interpolate(frame, [0, 32], [0, 26], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: '#080809', opacity, overflow: 'hidden'}}>
      <Backdrop src={event.image2 || event.image} dim={0.7} />
      <Grid color="#ffffff" opacity={0.06} />
      <div style={{position: 'absolute', left: '10%', top: '12%', color: '#f7f4ed', fontFamily: FONT.condensed, letterSpacing: 3, fontWeight: 800, fontSize: 16}}>{safeText(event.kicker, LBL(event.lang).person)}</div>
      <div style={{position: 'absolute', left: '15%', bottom: '8%', width: 210, height: 390, transform: `translate(${shadow}px, ${rise}px)`, background: accent, filter: 'blur(1px)', opacity: 0.88, borderRadius: '44% 48% 18% 22%'}} />
      <div style={{position: 'absolute', left: '10%', bottom: 0, width: '44%', height: '86%', transform: `translateY(${rise}px)`, overflow: 'hidden', filter: 'contrast(1.18)'}}>
        <Img src={media(event.image || FALLBACK.identity)} style={{position: 'absolute', left: 0, bottom: 0, width: '100%', height: 'auto', transform: 'scale(1.45)', transformOrigin: 'left bottom'}} />
      </div>
      <div style={{position: 'absolute', right: '10%', top: '35%', width: '42%', color: '#f6f4ef'}}>
        {(event.items || [])[0] ? <div style={{fontFamily: FONT.condensed, letterSpacing: 2.8, color: accent, fontWeight: 800, fontSize: 18, marginBottom: 14}}>{safeText((event.items || [])[0])}</div> : null}
        <div style={{fontFamily: FONT.display, fontSize: 62, lineHeight: .95, letterSpacing: -1.8, textTransform: 'uppercase'}}><TypeBuild text={name} start={18} speed={3} /></div>
        <div style={{marginTop: 25, width: '73%', height: 2, background: accent, transform: `scaleX(${enter})`, transformOrigin: 'left'}} />
        {event.subtitle ? <div style={{marginTop: 17, fontFamily: FONT.serif, fontSize: 26, lineHeight: 1.2, color: '#d9d4ca', opacity: Math.min(1, Math.max(0, (frame - 26) / 14))}}>{safeText(event.subtitle)}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

/** A real loupe movement, tied to a target on a source picture, rather than a static callout. */
export const InspectorLens: React.FC<{event: VidrushMotionEvent}> = ({event}) => {
  const {frame, enter, opacity} = useSceneMotion(event.duration);
  const accent = event.accent || '#d7ca8f';
  const tx = Math.max(.15, Math.min(.85, event.targetX ?? .63));
  const ty = Math.max(.18, Math.min(.76, event.targetY ?? .44));
  const progress = interpolate(frame, [9, 43], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const lensX = interpolate(progress, [0, 1], [23, tx * 100]);
  const lensY = interpolate(progress, [0, 1], [78, ty * 100]);
  const src = event.image || FALLBACK.inspection;
  return (
    <AbsoluteFill style={{background: '#111211', opacity}}>
      <Backdrop src={src} dim={0.62} />
      <Grid color="#d9d1b9" opacity={0.08} />
      <div style={{position: 'absolute', left: '13%', top: '12%', width: '74%', height: '73%', opacity: Math.min(1, enter * 1.25), border: '1px solid rgba(255,255,255,.75)', boxShadow: '0 25px 55px rgba(0,0,0,.42)', overflow: 'hidden'}}>
        <Img src={media(src)} style={{width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(.82) contrast(1.25)'}} />
      </div>
      <div style={{position: 'absolute', left: `calc(${lensX}% - 92px)`, top: `calc(${lensY}% - 92px)`, width: 184, height: 184, borderRadius: 184, overflow: 'hidden', border: `5px solid ${accent}`, boxShadow: '0 12px 28px rgba(0,0,0,.55)', transform: `scale(${0.35 + enter * .65})`, background: '#222'}}>
        <Img src={media(src)} style={{width: '310%', height: '310%', objectFit: 'cover', transform: `translate(${-tx * 66 + 16}%, ${-ty * 66 + 19}%)`, filter: 'grayscale(.3) contrast(1.45)'}} />
      </div>
      <div style={{position: 'absolute', left: `calc(${lensX}% + 57px)`, top: `calc(${lensY}% + 58px)`, width: 155, height: 2, background: accent, transform: 'rotate(35deg)', transformOrigin: 'left center'}} />
      <div style={{position: 'absolute', left: '11%', bottom: '8%', padding: '12px 18px', border: `1px solid ${accent}`, background: 'rgba(13,14,13,.88)', color: '#f7f4ea', fontFamily: FONT.condensed, fontWeight: 800, letterSpacing: 2.2, fontSize: 24}}>{safeText(event.title)}</div>
      <div style={{position: 'absolute', right: '10%', top: '9%', color: accent, fontFamily: FONT.condensed, letterSpacing: 3, fontWeight: 800, fontSize: 15}}>{LBL(event.lang).detail}</div>
    </AbsoluteFill>
  );
};

/** A physical cross section: ground, conduit and energy direction are drawn as an explanation. */
export const TechnicalCrossSection: React.FC<{event: VidrushMotionEvent}> = ({event}) => {
  const {frame, enter, opacity} = useSceneMotion(event.duration);
  const accent = event.accent || '#f0c927';
  const line = interpolate(frame, [8, 65], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const arrow = interpolate(frame, [54, 90], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const its = (event.items || []).map((s) => safeText(s)).filter(Boolean);
  const labels = [its[0] || '', its[1] || ''];
  return (
    <AbsoluteFill style={{background: '#0d1111', opacity}}>
      <div style={{position: 'absolute', left: 62, top: 50, color: accent, fontFamily: FONT.condensed, fontWeight: 800, letterSpacing: 3, fontSize: 17}}>{safeText(event.kicker, LBL(event.lang).section)}</div>
      <svg width="100%" height="100%" viewBox="0 0 1280 720" style={{position: 'absolute', inset: 0}}>
        <rect y="287" width="1280" height="433" fill="#4a392b" />
        <rect y="287" width="1280" height="16" fill="#d0b073" />
        <path d="M89 287 L173 169 L326 169 L396 287" fill="#e7e0d0" stroke="#101312" strokeWidth="7" />
        <rect x="205" y="213" width="84" height="74" fill="#16201c" stroke="#101312" strokeWidth="7" />
        <path d="M-14 385 C170 384 235 461 406 461 S654 547 792 503 S1002 393 1290 447" fill="none" stroke="#d8ddcd" strokeWidth="13" strokeDasharray="1550" strokeDashoffset={1550 * (1 - line)} />
        <path d="M-14 385 C170 384 235 461 406 461 S654 547 792 503 S1002 393 1290 447" fill="none" stroke="#1b2924" strokeWidth="6" />
        <circle cx={Math.min(1188, 90 + arrow * 1020)} cy={420 + Math.sin(arrow * Math.PI * 3) * 38} r="12" fill={accent} opacity={arrow} />
        <path d="M848 509 l22 -13 l-4 24 z" fill={accent} opacity={arrow} transform={`translate(${arrow * 180} ${Math.sin(arrow * Math.PI * 3) * -12})`} />
        <line x1="188" y1="121" x2="188" y2="174" stroke={accent} strokeWidth="2" />
        <line x1="914" y1="341" x2="914" y2="430" stroke={accent} strokeWidth="2" />
      </svg>
      <div style={{position: 'absolute', left: 92, top: 102, color: '#f2eee4', fontFamily: FONT.condensed, fontWeight: 800, letterSpacing: 2, fontSize: 17}}>{labels[0]}</div>
      <div style={{position: 'absolute', left: '70%', top: '46%', color: '#f2eee4', fontFamily: FONT.condensed, fontWeight: 800, letterSpacing: 2, fontSize: 17}}>{labels[1]}</div>
      <div style={{position: 'absolute', right: 68, bottom: 54, width: 350, color: '#f5f0e4', fontFamily: FONT.serif, fontSize: 31, lineHeight: 1.1, opacity: Math.min(1, enter * 1.3)}}>{safeText(event.title)}</div>
      <div style={{position: 'absolute', right: 68, bottom: 29, color: accent, fontFamily: FONT.condensed, fontSize: 15, fontWeight: 800, letterSpacing: 2.4}}>{safeText(event.subtitle)}</div>
    </AbsoluteFill>
  );
};

/** A documentary identification card. The name is composed, not dropped in as a lower third. */
export const FieldProfile: React.FC<{event: VidrushMotionEvent}> = ({event}) => {
  const {frame, enter, opacity} = useSceneMotion(event.duration);
  const accent = event.accent || '#e5dfd0';
  const inset = spring({frame: Math.max(0, frame - 8), fps: 30, config: {damping: 17, stiffness: 125, mass: .85}});
  // 2026-09-05 (banco Puebla): la ficha salía casi negra (brightness .52 + scrim .85), no pintaba
  // los 3 datos del planner, el inset repetía la misma imagen del fondo y el kicker caía a
  // inglés. Ahora: metraje visible, inset = image2 si existe, datos en lista, textos ES/neutros.
  const insetSrc = event.image2 || event.image || FALLBACK.profile;
  const facts = (event.items || []).map((s) => safeText(s)).filter(Boolean).slice(0, 3);
  return (
    <AbsoluteFill style={{background: '#17221d', opacity}}>
      <Img src={media(event.image || FALLBACK.profile)} style={{width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(.74) saturate(.82)'}} />
      <AbsoluteFill style={{background: 'linear-gradient(90deg, rgba(8,13,10,.78), rgba(8,13,10,.22) 58%, rgba(8,13,10,.10) 100%)'}} />
      <div style={{position: 'absolute', right: '7%', top: '9%', width: '27%', height: '40%', padding: 8, background: '#efeadf', transform: `translateY(${(1 - inset) * -72}px) rotate(1.5deg)`, boxShadow: '0 17px 38px rgba(0,0,0,.42)', opacity: Math.min(1, inset * 1.3)}}>
        <Img src={media(insetSrc)} style={{width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(.8) contrast(1.15)'}} />
      </div>
      <div style={{position: 'absolute', left: '8%', bottom: '12%', maxWidth: '56%', color: accent}}>
        <div style={{fontFamily: FONT.typewriter, fontSize: 15, letterSpacing: 2.1, marginBottom: 14, opacity: Math.min(1, enter * 1.35)}}>{safeText(event.kicker, LBL(event.lang).profile)}</div>
        <div style={{fontFamily: FONT.serif, fontSize: 68, lineHeight: .94, letterSpacing: -1, textShadow: '0 4px 22px rgba(0,0,0,.7)'}}><TypeBuild text={safeText(event.title)} start={16} speed={4} /></div>
        {event.subtitle ? <div style={{marginTop: 18, fontFamily: FONT.typewriter, fontSize: 19, letterSpacing: 1.2, textTransform: 'uppercase', opacity: Math.min(1, Math.max(0, (frame - 33) / 13))}}>{safeText(event.subtitle)}</div> : null}
        {facts.length ? (
          <div style={{marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8}}>
            {facts.map((f, k) => (
              <div key={k} style={{display: 'flex', gap: 12, alignItems: 'baseline', fontFamily: FONT.condensed, fontSize: 24, fontWeight: 700, color: '#f4f0e6', opacity: Math.min(1, Math.max(0, (frame - 42 - k * 8) / 12)), textShadow: '0 2px 12px rgba(0,0,0,.8)'}}>
                <span style={{width: 16, height: 3, background: accent, flexShrink: 0, transform: 'translateY(-6px)'}} />
                <span>{f}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** A date gets its own edit beat; no generic title panel is used. */
export const ArchiveDate: React.FC<{event: VidrushMotionEvent}> = ({event}) => {
  const {frame, enter, opacity} = useSceneMotion(event.duration);
  const accent = event.accent || '#ebc838';
  return (
    <AbsoluteFill style={{background: '#3b241f', opacity}}>
      <Img src={media(event.image || FALLBACK.archiveA)} style={{width: '100%', height: '100%', objectFit: 'cover', opacity: .37, filter: 'sepia(.7) contrast(1.1)'}} />
      <AbsoluteFill style={{background: 'rgba(42,20,15,.58)'}} />
      <div style={{position: 'absolute', left: '10%', top: '15%', color: '#fff6d8', fontFamily: FONT.condensed, fontWeight: 800, letterSpacing: 3, fontSize: 17}}>{safeText(event.kicker, LBL(event.lang).date)}</div>
      <div style={{position: 'absolute', left: '10%', bottom: '22%', color: accent, fontFamily: FONT.display, fontSize: 150, lineHeight: .86, letterSpacing: -3, transform: `translateY(${(1 - enter) * 36}px)`, textShadow: '0 8px 30px rgba(0,0,0,.6)'}}><TypeBuild text={safeText(event.title)} start={8} speed={5} /></div>
      <div style={{position: 'absolute', left: '10%', bottom: '12%', fontFamily: FONT.serif, fontSize: 34, color: '#f7ecce', opacity: Math.min(1, Math.max(0, (frame - 27) / 15))}}>{safeText(event.subtitle)}</div>
    </AbsoluteFill>
  );
};

/** Cards separate into a relationship layout and leave one documentary caption behind. */
export const EvidenceGallery: React.FC<{event: VidrushMotionEvent}> = ({event}) => {
  const {frame, opacity} = useSceneMotion(event.duration);
  const accent = event.accent || '#e9e3d5';
  const spread = spring({frame: Math.max(0, frame - 5), fps: 30, config: {damping: 17, stiffness: 125, mass: .8}});
  const items = (event.items || []).filter(Boolean).slice(0, 3);
  // Solo fotos REALES: antes la tercera posición era siempre FALLBACK.dossier (una tarjeta
  // crema VACÍA en pantalla — defecto visible en el banco 2026-09-05). Con 2 evidencias salen
  // 2 polaroids; con 1, una sola grande.
  const sources = [event.image, event.image2].filter((s): s is string => !!s && s !== EMPTY_MEDIA);
  const positions = sources.length >= 2
    ? [{x: -290, y: 10, r: -6}, {x: 290, y: -40, r: 5}, {x: 300, y: 184, r: -3}]
    : [{x: 0, y: -20, r: -3}, {x: 0, y: 0, r: 0}, {x: 0, y: 0, r: 0}];
  return (
    <AbsoluteFill style={{background: '#101010', opacity}}>
      <Backdrop src={event.image} />
      <Grid color="#ffffff" opacity={.07} />
      {sources.map((src, index) => {
        const target = positions[index];
        const x = interpolate(spread, [0, 1], [0, target.x]);
        const y = interpolate(spread, [0, 1], [0, target.y]);
        return <div key={src} style={{position: 'absolute', left: '39%', top: '29%', width: '27%', height: '37%', padding: 7, background: '#eeeadf', transform: `translate(${x}px, ${y}px) rotate(${target.r * spread}deg)`, boxShadow: '0 20px 44px rgba(0,0,0,.47)'}}>
          <Img src={media(src)} style={{width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(.6) contrast(1.1)'}} />
          <div style={{position: 'absolute', left: 8, right: 8, bottom: -29, color: accent, fontFamily: FONT.typewriter, fontSize: 12, letterSpacing: 1.2}}>{items[index] || `${LBL(event.lang).evn} / 0${index + 1}`}</div>
        </div>;
      })}
      <div style={{position: 'absolute', left: 67, bottom: 55, color: '#f0ede4', fontFamily: FONT.serif, fontSize: 42}}><TypeBuild text={safeText(event.title)} start={30} speed={4} /></div>
    </AbsoluteFill>
  );
};

export const isVidrushType = (type?: string): type is VidrushType =>
  (VIDRUSH_TYPES as readonly string[]).includes(String(type || ''));

/** Closed dispatch keeps the production renderer data-driven but bounded and testable. */
export const VidrushMotion: React.FC<{event: VidrushMotionEvent}> = ({event}) => {
  switch (event.type) {
    case 'vidrush_evidence_matrix': return <EvidenceMatrix event={event} />;
    case 'vidrush_dossier_compare': return <DossierCompare event={event} />;
    case 'vidrush_identity_cutout': return <IdentityCutout event={event} />;
    case 'vidrush_inspector_lens': return <InspectorLens event={event} />;
    case 'vidrush_cross_section': return <TechnicalCrossSection event={event} />;
    case 'vidrush_field_profile': return <FieldProfile event={event} />;
    case 'vidrush_archive_date': return <ArchiveDate event={event} />;
    case 'vidrush_evidence_gallery': return <EvidenceGallery event={event} />;
    default: return null;
  }
};
