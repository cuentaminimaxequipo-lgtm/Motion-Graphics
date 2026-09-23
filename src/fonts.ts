// Carga de FUENTES PREMIUM (2026-07-14, el usuario: "los motion se ven de AI, usa otras
// tipografías"). Fuentes tipo VidRush/BeyondMilitary: Anton (display condensada), Oswald +
// Barlow Condensed (labels), Bebas Neue (cifras/fechas), Archivo Black (impacto), Playfair
// Display (serif editorial). Ficheros en public/fonts (servidos por staticFile).
//
// ⚠⚠ BUG CRÍTICO RESUELTO (2026-07-14): usar delayRender() A NIVEL DE MÓDULO para esperar las
// fuentes ROMPÍA el render de Remotion. Dos causas: (1) el render CONGELA el reloj determinista
// → `setTimeout` no dispara → la salvaguarda nunca limpiaba el handle; (2) delayRender en el
// side-effect de un import (fuera de un componente) no se limpia de forma fiable y `window.
// FontFace`/`document.fonts.load` pueden colgarse en su Chrome headless. Resultado: a los ~10-28s
// Remotion ABORTABA (rc=1) → el pipeline caía a FFmpeg y los 8 overlays premium NO salían (justo
// lo que el usuario pedía).
//
// FIX DEFINITIVO: NO usar delayRender. Solo inyectar @font-face con `font-display:swap`. Así el
// render NUNCA se bloquea ni falla por las fuentes; el texto sale ya (fallback) y cambia a la
// premium en cuanto el fichero LOCAL carga (inmediato). Se lanza además un warm-up con FontFace
// (fire-and-forget, sin await) para que la premium esté lista cuanto antes. Robustez > que el
// primer frame use la premium.
import {staticFile} from 'remotion';

type F = {family: string; file: string; weight?: string};
export const FONTS: F[] = [
  {family: 'Anton', file: 'fonts/Anton-Regular.ttf', weight: '400'},
  {family: 'Oswald', file: 'fonts/Oswald-Bold.ttf', weight: '700'},
  {family: 'BebasNeue', file: 'fonts/BebasNeue-Regular.ttf', weight: '400'},
  {family: 'ArchivoBlack', file: 'fonts/ArchivoBlack-Regular.ttf', weight: '400'},
  {family: 'BarlowCondensed', file: 'fonts/BarlowCondensed-Bold.ttf', weight: '700'},
  {family: 'PlayfairDisplay', file: 'fonts/PlayfairDisplay-Bold.ttf', weight: '700'},
];

try {
  if (typeof document !== 'undefined') {
    // @font-face con font-display:swap → el texto NUNCA queda invisible ni bloquea el render.
    const style = document.createElement('style');
    style.textContent = FONTS.map(
      (f) =>
        `@font-face{font-family:'${f.family}';src:url('${staticFile(
          f.file
        )}') format('truetype');font-weight:${f.weight || '400'};font-style:normal;font-display:swap;}`
    ).join('\n');
    document.head.appendChild(style);

    // Warm-up FIRE-AND-FORGET (sin await, sin delayRender): acelera que la premium esté lista,
    // pero si falla o tarda, da igual — el render sigue con el fallback y swap se encarga.
    const anyWin = window as any;
    if (anyWin && typeof anyWin.FontFace === 'function') {
      FONTS.forEach((f) => {
        try {
          const ff = new anyWin.FontFace(
            f.family,
            `url('${staticFile(f.file)}') format('truetype')`,
            {weight: f.weight || '400', style: 'normal'}
          );
          ff.load()
            .then((loaded: any) => {
              try {
                (document as any).fonts.add(loaded);
              } catch (e) {
                /* noop */
              }
            })
            .catch(() => {
              /* el swap cubre el fallo */
            });
        } catch (e) {
          /* noop */
        }
      });
    }
  }
} catch (e) {
  // nunca romper el render por las fuentes
}
