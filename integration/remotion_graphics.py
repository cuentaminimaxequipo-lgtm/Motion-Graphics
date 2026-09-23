#!/usr/bin/env python3
"""
remotion_graphics.py - Motion graphics locales con Remotion.

Objetivo:
  - Low: cero IA. El SRT/manifest decide tiempos y Python genera overlays.
  - Mid/High: puede reutilizar el plan visual ya mejorado por Qwen, pero el
    render sigue siendo local.

No quema subtitulos. Genera piezas visuales: titulos full-screen, procesos,
checklists, timeline, quotes, lower thirds, evidencia, mapas, datos,
comparativas y palabras grandes.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import unicodedata
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / "motion" / "remotion_runtime"
PUBLIC = RUNTIME / "public"
ENTRY = RUNTIME / "src" / "index.tsx"


def _console_text(value) -> str:
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    return str(value).encode(enc, "replace").decode(enc, "replace")


def _portable_node_dir() -> Path | None:
    tools = ROOT / "tools"
    if not tools.exists():
        return None
    for p in sorted(tools.glob("node-*-win-x64"), reverse=True):
        if (p / "npm.cmd").exists():
            return p
    return None


def _env() -> dict:
    env = os.environ.copy()
    paths: list[str] = []
    node = _portable_node_dir()
    if node:
        paths.append(str(node))
    for exe in ("ffmpeg", "ffprobe"):
        found = shutil.which(exe)
        if found:
            paths.append(str(Path(found).parent))
    ffmpeg_bin = Path("C:/ffmpeg/bin")
    if ffmpeg_bin.exists():
        paths.append(str(ffmpeg_bin))
    base = env.get("Path") or env.get("PATH") or ""
    merged = ";".join(dict.fromkeys(paths + [base]))
    env["Path"] = merged
    env["PATH"] = merged
    return env


def _npm_cmd() -> str:
    node = _portable_node_dir()
    if node:
        return str(node / ("npm.cmd" if sys.platform.startswith("win") else "npm"))
    found = shutil.which("npm.cmd" if sys.platform.startswith("win") else "npm")
    if not found:
        raise RuntimeError("npm no encontrado. Falta Node portable o Node global.")
    return found


def _npx_cmd() -> str:
    node = _portable_node_dir()
    if node:
        return str(node / ("npx.cmd" if sys.platform.startswith("win") else "npx"))
    found = shutil.which("npx.cmd" if sys.platform.startswith("win") else "npx")
    if not found:
        raise RuntimeError("npx no encontrado. Falta Node portable o Node global.")
    return found


def _remotion_cmd() -> str:
    bin_name = "remotion.cmd" if sys.platform.startswith("win") else "remotion"
    local = RUNTIME / "node_modules" / ".bin" / bin_name
    if local.exists():
        return str(local)
    return _npx_cmd()


def _env_int(name: str, default: int, *, min_value: int = 1, max_value: int | None = None) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        value = int(raw) if raw else int(default)
    except ValueError:
        value = int(default)
    value = max(min_value, value)
    if max_value is not None:
        value = min(max_value, value)
    return value


def _env_gb_bytes(name: str, default_gb: int) -> int:
    raw = os.environ.get(name, "").strip().replace(",", ".")
    try:
        gb = float(raw) if raw else float(default_gb)
    except ValueError:
        gb = float(default_gb)
    gb = max(1.0, min(gb, 48.0))
    return int(gb * 1024 * 1024 * 1024)


def _remotion_performance_flags(motion_level: str = "") -> list[str]:
    # ⚡ 2026-08-06 (el usuario: "Remotion va a 3 ventanas cuando podría ir a 9"): 12 cores lógicos,
    # dejamos 3 para OS+server → tope 9. Default 6 (equilibrio velocidad/margen); si el vídeo se
    # renderiza solo (sin exports narco compitiendo), subir a 9 con REMOTION_CONCURRENCY=9.
    concurrency = str(_env_int("REMOTION_CONCURRENCY", 6, min_value=1, max_value=9))
    media_cache = str(_env_gb_bytes("REMOTION_MEDIA_CACHE_GB", 16))
    offthread_cache = str(_env_gb_bytes("REMOTION_OFFTHREAD_CACHE_GB", 8))
    hw = os.environ.get("REMOTION_HW_ACCEL", "if-possible").strip() or "if-possible"
    gl = os.environ.get("REMOTION_GL", "angle").strip()
    crf = os.environ.get("REMOTION_CRF", "18").strip() or "18"
    x264 = os.environ.get("REMOTION_X264_PRESET", "veryfast").strip() or "veryfast"
    # 2026-08-07: motion=low ⇒ Remotion reencoda vídeo largo por pocos overlays. Bajamos calidad
    # de reencoder (CRF 23 + ultrafast) para ~2x speed. El vídeo BASE ya va CRF 23, no se degrada.
    if (motion_level or "").lower() == "low":
        crf = os.environ.get("REMOTION_CRF_LOW", "23").strip() or "23"
        x264 = os.environ.get("REMOTION_X264_PRESET_LOW", "ultrafast").strip() or "ultrafast"
    # ⚠ 2026-08-04 (MANAGUA): el overlay FALLÓ con `delayRender() "Fetching http://localhost..."`
    # timeout — el default de Remotion son 30s y en vídeos ENORMES (383 escenas/~78min) el fetch del
    # vídeo de fondo tarda más → sin rótulos. `--timeout` sube el tope del delayRender (ms).
    dr_timeout = os.environ.get("REMOTION_DELAYRENDER_MS", "180000").strip() or "180000"
    # ⚠ 2026-08-06 (el usuario, motion FALLA): "Timed out after 25000 ms while trying to connect to
    # the browser" — el ARRANQUE de Chrome tardaba >25s con la MÁQUINA SATURADA (4 exports a tope) y
    # Remotion abortaba → sin motion. NO hay flag `--browser-timeout` en el CLI de Remotion (era de
    # HyperFrames). El fix real: lanzar el motion con la máquina MENOS cargada (tras los exports), y/o
    # bajar `--concurrency` (REMOTION_CONCURRENCY) para que Chrome arranque sin pelear por CPU.
    flags = [
        "--concurrency", concurrency,
        "--codec", "h264",
        "--crf", crf,
        "--x264-preset", x264,
        "--timeout", dr_timeout,
        "--hardware-acceleration", hw,
        "--media-cache-size-in-bytes", media_cache,
        "--offthreadvideo-cache-size-in-bytes", offthread_cache,
    ]
    if gl:
        flags += ["--gl", gl]
    return flags


def _start_lock_heartbeat(service: str):
    stop = threading.Event()

    def beat():
        try:
            from scripts.profile_utils import touch_service_lock
        except Exception:
            return
        while not stop.wait(30):
            touch_service_lock(service)

    t = threading.Thread(target=beat, daemon=True)
    t.start()
    return stop


def remotion_available() -> bool:
    return ENTRY.exists() and (_portable_node_dir() is not None or shutil.which("npx") is not None)


def _ensure_runtime(log=print) -> None:
    if not (RUNTIME / "package.json").exists():
        raise RuntimeError(f"Runtime Remotion no existe: {RUNTIME}")
    if (RUNTIME / "node_modules" / ".bin" / ("remotion.cmd" if sys.platform.startswith("win") else "remotion")).exists():
        return
    log("[remotion] Instalando dependencias locales...")
    r = subprocess.run(
        [_npm_cmd(), "install"],
        cwd=str(RUNTIME),
        env=_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=300,
    )
    if r.returncode != 0:
        raise RuntimeError(f"npm install fallo: {(r.stderr or r.stdout)[-1200:]}")


def _duration(video_path: str) -> float:
    try:
        # A muxed MP4 may advertise the audio duration at the container level
        # while its video stream is shorter (the Sydney proof had a nominal
        # 60-second file with only 15.5 seconds/465 frames of video). Motion
        # windows and the concat guard must use the actual video stream.
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=duration,r_frame_rate",
             "-of", "json", video_path], capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=30,
        )
        streams = (json.loads(r.stdout or "{}").get("streams") or [])
        if streams:
            s = streams[0] or {}
            try:
                d = float(s.get("duration") or 0.0)
            except (TypeError, ValueError):
                d = 0.0
            if d > 0:
                return max(0.1, d)
        # Last resort for unusual containers without a video stream probe.
        r2 = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", video_path],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
        )
        return max(0.1, float((r2.stdout or "0").strip()))
    except (ValueError, json.JSONDecodeError, OSError, subprocess.SubprocessError):
        return 5.0


def _parse_fps(value: str) -> float:
    value = (value or "").strip()
    if not value or value == "0/0":
        return 30.0
    try:
        fps = float(Fraction(value))
    except Exception:
        try:
            fps = float(value)
        except ValueError:
            fps = 30.0
    if fps <= 0:
        return 30.0
    return fps


def _video_meta(video_path: str) -> dict:
    """Read source metadata so Remotion does not create FPS cadence stutter."""
    r = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate:format=duration",
            "-of", "json",
            video_path,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    try:
        data = json.loads(r.stdout or "{}")
    except json.JSONDecodeError:
        data = {}
    stream = (data.get("streams") or [{}])[0] or {}
    fmt = data.get("format") or {}
    duration = 0.0
    try:
        duration = float(fmt.get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    width = int(stream.get("width") or 1920)
    height = int(stream.get("height") or 1080)
    fps = _parse_fps(stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "30/1")
    return {
        "duration": max(0.1, duration or _duration(video_path)),
        "width": max(16, width),
        "height": max(16, height),
        "fps": fps,
    }


def _env_float(name: str, default: float, *, min_value: float = 1.0, max_value: float | None = None) -> float:
    raw = os.environ.get(name, "").strip().replace(",", ".")
    try:
        value = float(raw) if raw else float(default)
    except ValueError:
        value = float(default)
    value = max(min_value, value)
    if max_value is not None:
        value = min(max_value, value)
    return value


def _render_timeout(duration: float) -> int | None:
    raw = os.environ.get("REMOTION_TIMEOUT_SEC", "").strip()
    # SOLO sin límite si se pide EXPLÍCITAMENTE (0/none/off). El vacío YA NO es sin límite.
    if raw.lower() in {"0", "none", "no", "off", "false", "unlimited", "sin_limite"}:
        return None
    if raw:
        try:
            return max(60, int(float(raw)))
        except ValueError:
            pass
    # ⚠ BACKSTOP FINITO (2026-07-15): antes el vacío devolvía None = subprocess.run(timeout=None)
    # = SIN límite → un render de Remotion COLGADO corría PARA SIEMPRE sujetando el lock de export
    # y starvaba la cola (un-simple bloqueado 3h por el 'mataram' colgado en Motion graphics, 0
    # frames en 81 min). Ahora SIEMPRE hay tope: ~40s de render por segundo de vídeo, mínimo 30
    # min, cap REMOTION_TIMEOUT_CAP_SEC (def 4h). No mata renders legítimos (terminan mucho antes);
    # sí mata cuelgues → al fallar, el `finally` libera el lock y la cola avanza.
    try:
        d = max(60.0, float(duration or 0))
    except (TypeError, ValueError):
        d = 600.0
    try:
        cap = int(os.environ.get("REMOTION_TIMEOUT_CAP_SEC", "14400") or 14400)
    except (TypeError, ValueError):
        cap = 14400
    return min(cap, max(1800, int(d * 40)))


def _dump_remotion_fail(out, cmd, rc, timeout_s, stderr, stdout) -> None:
    """Vuelca el error COMPLETO de Remotion a <job>/_remotion_fail.log.

    El tail (1600 chars) que va al RuntimeError se trunca y el stdout del runner
    se pierde; sin esto no hay forma de saber POR QUÉ Remotion crashea en un
    vídeo (igual que _ffmpeg_fail.log destapó el filtro inválido). Falla-seguro.
    """
    try:
        log_path = Path(out).parent / "_remotion_fail.log"
        with open(log_path, "a", encoding="utf-8", errors="replace") as fh:
            fh.write(f"\n===== rc={rc} timeout_s={timeout_s} =====\n")
            fh.write("CMD: " + " ".join(str(c) for c in (cmd or [])) + "\n")
            fh.write("STDERR:\n" + (stderr or "") + "\n")
            fh.write("STDOUT:\n" + (stdout or "") + "\n")
    except Exception:
        pass


def _max_motion_events(quality: str, motion_level: str) -> int:
    key = {
        "low": "REMOTION_MAX_EVENTS_LOW",
        "mid": "REMOTION_MAX_EVENTS_MID",
        "high": "REMOTION_MAX_EVENTS_HIGH",
    }.get((quality or "mid").lower(), "REMOTION_MAX_EVENTS_MID")
    defaults = {"low": 36, "mid": 52, "high": 90}
    if (motion_level or "").lower() == "low":
        defaults = {"low": 24, "mid": 34, "high": 48}
    if (motion_level or "").lower() == "high":
        defaults = {"low": 52, "mid": 72, "high": 120}
    return _env_int(key, defaults.get((quality or "mid").lower(), 52), min_value=1, max_value=240)


def _thin_motion_events(events: list[dict], cap: int) -> list[dict]:
    if len(events) <= cap:
        return events
    priority_types = {
        "title_full", "ae_depth_title", "stat_wall", "ae_data_orbit",
        "evidence_card", "map_callout", "before_after", "process_flow",
        "ae_hud_panel", "ae_node_map", "ae_object_rig", "ae_device_scene",
        "ae_workflow_blueprint", "ae_code_orchestrator",
    }
    ranked = sorted(
        enumerate(events),
        key=lambda pair: (
            0 if pair[1].get("type") in priority_types else 1,
            0 if pair[0] in {0, len(events) - 1} else 1,
            pair[1].get("start", 0),
        ),
    )
    keep = {idx for idx, _event in ranked[:cap]}
    keep.add(0)
    keep.add(len(events) - 1)
    return [event for idx, event in enumerate(events) if idx in keep]


def _plain(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


# Palabras-número en español (el guion escribe las cifras EN PALABRAS, no en dígitos:
# "veinte mil", no "20.000"). Se usan para localizar DÓNDE se dice la cifra dentro de la
# frase y CUADRAR el count-up con la voz.
_NUM_WORDS_ES = {
    "cero", "un", "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho",
    "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciseis", "diecisiete",
    "dieciocho", "diecinueve", "veinte", "veintiun", "veintiuno", "veintidos", "veintitres",
    "veinticuatro", "veinticinco", "veintiseis", "veintisiete", "veintiocho", "veintinueve",
    "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa",
    "cien", "ciento", "cientos", "doscientos", "trescientos", "cuatrocientos", "quinientos",
    "seiscientos", "setecientos", "ochocientos", "novecientos",
    "mil", "miles", "millon", "millones", "millardo", "billon", "billones",
    "media", "medio", "docena", "docenas", "centenar", "centenares", "decenas",
}

# Palabras-número/medida en INGLÉS (los guiones en EN escriben las cifras en palabras igual que
# los ES: "nearly a mile long", "the second time"). Sin esto, _number_pos_ratio (solo-ES) devolvía
# None en vídeos en inglés → TODA cifra hablada se marcaba como "fantasma" y se descartaba. Incluye
# cardinales, ordinales y unidades habituales que SON la forma hablada de un dato (milla, km…).
_NUM_WORDS_EN = {
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
    "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "hundred", "thousand", "million", "millions", "billion", "billions", "trillion",
    "dozen", "dozens", "half", "quarter", "single", "double", "triple", "once", "twice",
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
    # unidades de medida = forma hablada de una cifra (distancia/peso/porcentaje)
    "mile", "miles", "kilometer", "kilometers", "kilometre", "kilometres", "km",
    "meter", "meters", "metre", "metres", "foot", "feet", "yard", "yards",
    "percent", "ton", "tons", "tonne", "tonnes",
}

# Unión ES+EN para la detección de cifra hablada (genérico multi-idioma).
_NUM_WORDS_ALL = _NUM_WORDS_ES | _NUM_WORDS_EN


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn")


def _has_number(s: str) -> bool:
    """¿El título lleva una cifra (dígito)? El count-up solo cuenta si es numérico."""
    return bool(re.search(r"\d", s or ""))


def _norm_low(s: str) -> str:
    return _strip_accents((s or "").lower().strip())


def _as_float(v, default: float) -> float:
    try:
        f = float(v)
        return f if f == f else default  # descarta NaN
    except (TypeError, ValueError):
        return default


# País ES→EN (nombres de world-atlas). Solo si resuelve se usa el MAPA VECTORIAL (GeoMap);
# si no, cae al mapa ráster de siempre. Cubre los países más frecuentes de los canales.
_COUNTRY_EN = {
    "rusia": "Russia", "mexico": "Mexico", "méxico": "Mexico", "ucrania": "Ukraine",
    "estados unidos": "United States of America", "eeuu": "United States of America",
    "ee.uu.": "United States of America", "ee. uu.": "United States of America",
    "iran": "Iran", "irán": "Iran", "israel": "Israel", "china": "China", "siria": "Syria",
    "irak": "Iraq", "iraq": "Iraq", "colombia": "Colombia", "venezuela": "Venezuela",
    "brasil": "Brazil", "argentina": "Argentina", "espana": "Spain", "españa": "Spain",
    "francia": "France", "alemania": "Germany", "italia": "Italy", "portugal": "Portugal",
    "reino unido": "United Kingdom", "inglaterra": "United Kingdom", "japon": "Japan",
    "japón": "Japan", "corea del norte": "North Korea", "corea del sur": "South Korea",
    "afganistan": "Afghanistan", "afganistán": "Afghanistan", "arabia saudi": "Saudi Arabia",
    "arabia saudita": "Saudi Arabia", "turquia": "Turkey", "turquía": "Turkey",
    "egipto": "Egypt", "libia": "Libya", "polonia": "Poland", "india": "India",
    "pakistan": "Pakistan", "pakistán": "Pakistan", "canada": "Canada", "canadá": "Canada",
    "cuba": "Cuba", "yemen": "Yemen", "líbano": "Lebanon", "libano": "Lebanon",
    "taiwan": "Taiwan", "taiwán": "Taiwan", "australia": "Australia", "chile": "Chile",
}
# ── MAPAS DE CUALQUIER PAÍS DEL MUNDO (el usuario 2026-07-16: "los mapas animados deben ser
# de cualquier parte del mundo... en cualquier país del mundo"; México/Francia solo eran ejemplos).
# La tabla de arriba estaba HARDCODEADA a ~45 países "de telediario" → un vídeo sobre Nigeria,
# Vietnam, Perú o Tailandia NO resolvía mapa. world-atlas (el MISMO dataset que dibuja GeoMap)
# trae 241 países: se cargan TODOS desde ahí (fuente única de verdad → el focusName siempre casa
# con byName() del renderer). Si el archivo falta, se conserva la tabla curada de arriba.
def _world_atlas_countries() -> set[str]:
    try:
        _wa = (Path(__file__).resolve().parent.parent / "motion" / "remotion_runtime" /
               "node_modules" / "world-atlas" / "countries-50m.json")
        _d = json.loads(_wa.read_text(encoding="utf-8"))
        return {(g.get("properties") or {}).get("name", "")
                for g in _d["objects"]["countries"]["geometries"]} - {""}
    except Exception:
        return set()


def _norm_country(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower().strip())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


_WORLD_COUNTRIES = _world_atlas_countries()
if _WORLD_COUNTRIES:
    # 1) Cada país por su nombre EN (y su forma sin acentos/minúsculas) → cubre guiones en
    #    inglés y TODOS los nombres ES que coinciden (Nigeria, Chile, Cuba, Perú→Peru, Angola…).
    for _c in _WORLD_COUNTRIES:
        _COUNTRY_EN.setdefault(_norm_country(_c), _c)
    # 2) Nombres ES que NO coinciden con el inglés. Se VALIDAN contra world-atlas: si el destino
    #    no existe en el dataset (nombres abreviados tipo "Dominican Rep."), la entrada se ignora
    #    en vez de generar un focusName que el mapa no sabría dibujar.
    _ES_EXTRA = {
        "alemania": "Germany", "argelia": "Algeria", "belgica": "Belgium", "bielorrusia": "Belarus",
        "birmania": "Myanmar", "camboya": "Cambodia", "camerun": "Cameroon", "chipre": "Cyprus",
        "croacia": "Croatia", "dinamarca": "Denmark", "eslovaquia": "Slovakia", "eslovenia": "Slovenia",
        "etiopia": "Ethiopia", "filipinas": "Philippines", "finlandia": "Finland", "grecia": "Greece",
        "groenlandia": "Greenland", "hungria": "Hungary", "irlanda": "Ireland", "islandia": "Iceland",
        "jordania": "Jordan", "kenia": "Kenya", "letonia": "Latvia", "lituania": "Lithuania",
        "marruecos": "Morocco", "noruega": "Norway", "nueva zelanda": "New Zealand",
        "paises bajos": "Netherlands", "holanda": "Netherlands", "republica checa": "Czechia",
        "chequia": "Czechia", "rumania": "Romania", "singapur": "Singapore", "sudafrica": "South Africa",
        "suecia": "Sweden", "suiza": "Switzerland", "tailandia": "Thailand", "zimbabue": "Zimbabwe",
        "emiratos arabes unidos": "United Arab Emirates", "costa de marfil": "Côte d'Ivoire",
        "nigeria": "Nigeria", "vietnam": "Vietnam", "indonesia": "Indonesia", "malasia": "Malaysia",
        "peru": "Peru", "panama": "Panama", "ecuador": "Ecuador", "bolivia": "Bolivia",
        "uruguay": "Uruguay", "paraguay": "Paraguay", "guatemala": "Guatemala", "honduras": "Honduras",
        "nicaragua": "Nicaragua", "salvador": "El Salvador", "el salvador": "El Salvador",
        "republica dominicana": "Dominican Rep.", "senegal": "Senegal", "ghana": "Ghana",
        "sudan": "Sudan", "somalia": "Somalia", "argelia ": "Algeria", "tunez": "Tunisia",
        "kazajistan": "Kazakhstan", "uzbekistan": "Uzbekistan", "azerbaiyan": "Azerbaijan",
        "georgia": "Georgia", "armenia": "Armenia", "serbia": "Serbia", "albania": "Albania",
        "bulgaria": "Bulgaria", "austria": "Austria", "mongolia": "Mongolia", "nepal": "Nepal",
        "bangladesh": "Bangladesh", "sri lanka": "Sri Lanka", "tanzania": "Tanzania",
        "uganda": "Uganda", "mozambique": "Mozambique", "angola": "Angola", "congo": "Dem. Rep. Congo",
    }
    for _k, _v in _ES_EXTRA.items():
        if _v in _WORLD_COUNTRIES:
            _COUNTRY_EN.setdefault(_norm_country(_k), _v)

_COUNTRY_EN_SET = set(_COUNTRY_EN.values())
# Alias en INGLÉS (los guiones en EN nombran el país en inglés). Sin esto, _vector_geo no
# autodetectaba países en vídeos en inglés (solo claves ES) ni cuadraba un motion_country ya en
# inglés/minúscula, y la detección de TRAYECTO no encontraba el segundo país ("United States").
for _v in list(_COUNTRY_EN_SET):
    _COUNTRY_EN.setdefault(_v.lower(), _v)
_COUNTRY_EN.update({
    "united states": "United States of America", "the united states": "United States of America",
    "usa": "United States of America", "u.s.a.": "United States of America",
    "america": "United States of America",
    "uk": "United Kingdom", "britain": "United Kingdom", "great britain": "United Kingdom",
    "england": "United Kingdom",
})


# Gazetteer determinista lugar→(etiqueta pin, país EN para GeoMap/contorno). Claves en
# minúscula y SIN acentos (el texto se normaliza igual). Ciudades/regiones → su país para que
# el contorno cuadre. Ampliable con lo que salga en los guiones del usuario.
_GEO_GAZETTEER = [
    ("ucrania", ("Ucrania", "Ukraine")), ("ukraine", ("Ucrania", "Ukraine")),
    ("ukrainian", ("Ucrania", "Ukraine")),
    ("kiev", ("Kiev", "Ukraine")), ("kyiv", ("Kiev", "Ukraine")),
    ("crimea", ("Crimea", "Ukraine")), ("donbas", ("Donbás", "Ukraine")),
    ("mariupol", ("Mariúpol", "Ukraine")), ("jarkov", ("Járkov", "Ukraine")),
    ("rusia", ("Rusia", "Russia")), ("russia", ("Rusia", "Russia")),
    ("russian", ("Rusia", "Russia")),
    ("moscu", ("Moscú", "Russia")), ("moscow", ("Moscú", "Russia")), ("kremlin", ("Moscú", "Russia")),
    ("siberia", ("Siberia", "Russia")), ("san petersburgo", ("San Petersburgo", "Russia")),
    ("artico", ("Ártico", "Russia")), ("arctic", ("Ártico", "Russia")),
    ("estados unidos", ("EE. UU.", "United States of America")),
    ("eeuu", ("EE. UU.", "United States of America")),
    ("washington", ("Washington", "United States of America")),
    ("florida", ("Florida", "United States of America")),
    ("mexico", ("México", "Mexico")), ("sinaloa", ("Sinaloa", "Mexico")),
    ("culiacan", ("Culiacán", "Mexico")), ("altiplano", ("Altiplano", "Mexico")),
    ("china", ("China", "China")), ("pekin", ("Pekín", "China")), ("beijing", ("Pekín", "China")),
    ("espana", ("España", "Spain")), ("madrid", ("Madrid", "Spain")),
    ("barcelona", ("Barcelona", "Spain")), ("valencia", ("Valencia", "Spain")),
    ("francia", ("Francia", "France")), ("paris", ("París", "France")),
    ("normandia", ("Normandía", "France")),
    ("alemania", ("Alemania", "Germany")), ("berlin", ("Berlín", "Germany")),
    ("reino unido", ("Reino Unido", "United Kingdom")), ("londres", ("Londres", "United Kingdom")),
    ("italia", ("Italia", "Italy")), ("roma", ("Roma", "Italy")),
    ("japon", ("Japón", "Japan")), ("tokio", ("Tokio", "Japan")),
    ("india", ("India", "India")), ("brasil", ("Brasil", "Brazil")),
    ("israel", ("Israel", "Israel")), ("gaza", ("Gaza", "Israel")),
    ("iran", ("Irán", "Iran")), ("teheran", ("Teherán", "Iran")),
    ("siria", ("Siria", "Syria")), ("irak", ("Irak", "Iraq")), ("iraq", ("Irak", "Iraq")),
    ("afganistan", ("Afganistán", "Afghanistan")), ("kabul", ("Kabul", "Afghanistan")),
    ("groenlandia", ("Groenlandia", "Greenland")), ("polonia", ("Polonia", "Poland")),
    ("turquia", ("Turquía", "Turkey")), ("egipto", ("Egipto", "Egypt")),
    ("corea del norte", ("Corea del Norte", "North Korea")),
    ("corea del sur", ("Corea del Sur", "South Korea")),
    ("taiwan", ("Taiwán", "Taiwan")), ("vietnam", ("Vietnam", "Vietnam")),
]


def _vector_geo(scene: dict, accent: str = "#e23b3b", strike: bool = False) -> dict:
    """Emite datos para el MAPA VECTORIAL (GeoMap): país a enfocar/teñir + marcador y ruta
    derivados de motion_target_x/y y motion_route_x/y sobre motion_map_bounds. Solo si el país
    RESUELVE a un nombre de world-atlas (si no, {} → mapa ráster de siempre). GEO_VECTOR_MAP=0 lo apaga."""
    if os.environ.get("GEO_VECTOR_MAP", "1").strip().lower() in {"0", "false", "no", "off"}:
        return {}
    raw = (scene.get("motion_country") or scene.get("country") or "").strip()
    if not raw:
        # AUTO-DETECCIÓN universal (cualquier nicho): si el planner NO marcó país, buscar uno
        # REAL en el texto/título/lugar de la escena → así toda escena de mapa que nombre un
        # país sale como GeoMap VECTORIAL (formas reales) en vez de stock "mapa" con basura
        # (globos de dibujo, tableros de Risk…). 0 créditos. Claves largas primero (multi-
        # palabra) y con límite de palabra para no colar "cuba" dentro de "incubadora".
        hay = " ".join(str(scene.get(k) or "") for k in
                       ("text", "title", "motion_loc", "location", "locName")).lower()
        import re as _re_geo
        if hay.strip():
            for _k in sorted(_COUNTRY_EN, key=len, reverse=True):
                if _re_geo.search(r"(?<![\w])" + _re_geo.escape(_k) + r"(?![\w])", hay):
                    raw = _k
                    break
        # FALLBACK al PAÍS del VÍDEO (2026-07-14, referente Beyond Military: usar mapas vectoriales
        # de verdad). Si la escena nombra un lugar sin país (p.ej. "Altiplano") pero TODO el vídeo
        # va de un país (El Chapo→México), el mapa debe salir de ESE país en vez de degradarse a
        # rótulo. Se coge del tema/contexto del vídeo (que sí lo nombra).
        if not raw:
            _ctx = (os.environ.get("PIPELINE_VIDEO_CONTEXT", "") + " "
                    + os.environ.get("PIPELINE_VIDEO_TOPIC", "")).lower()
            if _ctx.strip():
                for _k in sorted(_COUNTRY_EN, key=len, reverse=True):
                    if _re_geo.search(r"(?<![\w])" + _re_geo.escape(_k) + r"(?![\w])", _ctx):
                        raw = _k
                        break
        if not raw:
            return {}
    en = _COUNTRY_EN.get(raw.lower(), raw if raw in _COUNTRY_EN_SET else "")
    if not en:
        return {}
    out: dict = {"focusName": en, "highlight": [{"name": en, "color": accent}]}
    b = scene.get("motion_map_bounds") or scene.get("map_bounds")

    def _ll(tx, ty):
        try:
            lon0, lat0, lon1, lat1 = (float(x) for x in b)
            return (lon0 + float(tx) * (lon1 - lon0), lat1 - float(ty) * (lat1 - lat0))
        except Exception:
            return None

    tx, ty = scene.get("motion_target_x"), scene.get("motion_target_y")
    loc = (scene.get("motion_loc") or scene.get("location") or "").strip()
    if b and tx is not None and ty is not None:
        p = _ll(tx, ty)
        if p:
            mk = {"lon": p[0], "lat": p[1], "color": "#ffcf4d"}
            if loc:
                mk["label"] = loc[:40]
            out["markers"] = [mk]
            rx, ry = scene.get("motion_route_x"), scene.get("motion_route_y")
            if rx is not None and ry is not None:
                q = _ll(rx, ry)
                if q:
                    out["geoRoute"] = {"fromLon": p[0], "fromLat": p[1],
                                       "toLon": q[0], "toLat": q[1], "color": accent, "strike": strike}
    # JOURNEY genérico (sin route del planner): si la escena implica un TRAYECTO (de X a Y / escape /
    # ruta / avanzó hacia) y en el texto resuelve un SEGUNDO país DISTINTO del enfocado, se traza una
    # geoRoute animada entre los centroides de ambos países (GeoMap la dibuja). Cualquier nicho.
    if "geoRoute" not in out:
        _blob = " ".join(str(scene.get(k) or "") for k in ("text", "title", "motion_title", "query")).lower()
        _journey = re.compile(
            r"\b(from|to|toward|towards|into|through|across|fled|flee|escap\w*|route|advanc\w*|"
            r"retreat\w*|mov\w+ to|push\w* to|march\w*|cross\w*|"
            r"hacia|hasta|rumbo|de\s+\w+\s+a\s+\w+|huy\w*|avanz\w*|cruz\w*|retir\w*|ruta|escap\w*)\b")
        if _journey.search(_blob):
            _dst = ""
            import re as _re_j
            for _k in sorted(_COUNTRY_EN, key=len, reverse=True):
                _en2 = _COUNTRY_EN[_k]
                if _en2 == en:
                    continue
                if _re_j.search(r"(?<![\w])" + _re_j.escape(_k) + r"(?![\w])", _blob):
                    _dst = _en2
                    break
            if _dst:
                try:
                    from scripts.geo_outline import country_centroid as _cc
                    _wb = (-180.0, -90.0, 180.0, 90.0)
                    _a = _cc(en, _wb)
                    _bb = _cc(_dst, _wb)
                    if _a and _bb:
                        # centroid devuelve fracciones 0..1 (y invertida) → volver a lon/lat
                        _flon, _flat = _a[0] * 360 - 180, 90 - _a[1] * 180
                        _tlon, _tlat = _bb[0] * 360 - 180, 90 - _bb[1] * 180
                        out["highlight"] = [{"name": en, "color": accent},
                                            {"name": _dst, "color": accent}]
                        out["geoRoute"] = {"fromLon": _flon, "fromLat": _flat,
                                           "toLon": _tlon, "toLat": _tlat, "color": accent, "strike": strike}
                except Exception:
                    pass
    return out


# ── DOS ESTILOS DE MAPA QUE ROTAN (2026-07-17) ───────────────────────────────────────────────
# El usuario aprobó el mapa VECTORIAL minimalista (GeoMap) y quiere que ADEMÁS vuelva el moderno
# CON NUBES (CloudMapZoom sobre ráster), rotando: "este estilo simple y minimalista que ya me
# gusta, pero también en algunos vídeos que tenga las dos opciones para rotar, ese que se ve más
# moderno, con las nubes".
#   MOTION_MAP_STYLE = auto (def.) | vector | clouds   → el canal/vídeo puede fijarlo.
#   auto = ROTACIÓN DETERMINISTA (nunca aleatoria): semilla estable del vídeo (job/tema) + orden
#   del mapa dentro del vídeo. El mismo vídeo elige SIEMPRE lo mismo; un vídeo con varios mapas
#   los ALTERNA (uno minimalista, el siguiente con nubes).
def _map_style_seed() -> int:
    """Semilla ESTABLE por vídeo (id de job, o tema/contexto). hashlib, no hash() (que va salteado
    por PYTHONHASHSEED y haría la rotación irreproducible entre procesos)."""
    src = (os.environ.get("PIPELINE_JOB_ID") or os.environ.get("PIPELINE_VIDEO_TOPIC")
           or os.environ.get("PIPELINE_VIDEO_CONTEXT") or "video").strip().lower()
    return int(hashlib.md5(src.encode("utf-8", "replace")).hexdigest()[:8], 16)


def _map_style_for(index: int) -> str:
    """'vector' | 'clouds' para el mapa nº `index` (0-based) del vídeo."""
    mode = (os.environ.get("MOTION_MAP_STYLE") or "auto").strip().lower()
    if mode in {"vector", "geo", "geomap", "minimal", "minimalista", "vectorial", "simple"}:
        return "vector"
    if mode in {"clouds", "cloud", "nubes", "modern", "moderno", "satelite", "satélite",
                "satellite", "raster", "ráster"}:
        return "clouds"
    return "vector" if (_map_style_seed() + index) % 2 == 0 else "clouds"


def _map_raster_autoresolve(ev: dict, country: str = "", bounds=None) -> tuple:
    """AUTO-RESOLVE del mapa RÁSTER de CloudMapZoom (el planner NO tiene rutas de mapas): con el
    país basta. Si no hay imagen válida → mapa NASA del repo (assets/maps/world_topo.jpg, bounds
    mundiales exactos), target = lugar geocodificado (Normandía→costa, Monterrey≠CDMX; el
    centroide del país es el último recurso) y bandera = flagcdn por ISO. Rellena en `ev`:
    image / targetX / targetY / flag / locName. Devuelve (country, bounds) ya resueltos.

    Lo usan LOS DOS caminos: build_motion_events (para los mapas que la rotación manda al estilo
    NUBES → el evento ya sale con su ráster) y prepare_remotion_project (mapas legacy/editor que
    llegan sin resolver). Idempotente: con una imagen ya válida no toca nada.
    """
    _country = (country or "").strip()
    # ETIQUETA antes del auto-resolve: si el planner no dio motion_loc, usar la primera
    # parte del TÍTULO ("Normandía, Francia" → "Normandía") — no el país (eso es la bandera).
    if not str(ev.get("locName") or "").strip():
        _t0 = str(ev.get("title") or "").split(",")[0].strip()
        if _t0:
            ev["locName"] = _t0[:40]
    _img = str(ev.get("image") or "").strip()
    _default_map = ROOT / "assets" / "maps" / "world_topo.jpg"
    _img_ok = False
    if _img and not _img.startswith(("http:", "https:", "data:")):
        try:
            _img_ok = Path(_img.replace("file:///", "").replace("file://", "")).exists() \
                or (PUBLIC / _img).exists()
        except Exception:
            _img_ok = False
    if not _country:
        # El planner a veces solo da la etiqueta ("Normandía, Francia") → deducir el país
        # probando las partes del locName/título contra las fronteras (geo_outline).
        try:
            from scripts.geo_outline import country_exists
            for _txt in (str(ev.get("locName") or ""), str(ev.get("title") or "")):
                for _part in re.split(r"[,/·]| en ", _txt):
                    _part = _part.strip()
                    if len(_part) >= 4 and country_exists(_part):
                        _country = _part
                        break
                if _country:
                    break
        except Exception:
            pass
    if not _img_ok and _country and _default_map.exists():
        _img = str(_default_map)
        bounds = [-180.0, -90.0, 180.0, 90.0]
        try:
            from scripts.geo_outline import country_centroid, country_iso2
            # TARGET REAL: geocodificar el LUGAR (Normandía→costa, Monterrey≠CDMX). El
            # centroide del país es solo el último recurso.
            _c = None
            _place = str(ev.get("locName") or "").split(",")[0].strip()
            if _place and _norm_low(_place) != _norm_low(_country):
                try:
                    from scripts.geo_places import geocode_place
                    _ll = geocode_place(_place, _country)
                    if _ll:
                        _c = [(_ll[0] + 180.0) / 360.0, (90.0 - _ll[1]) / 180.0]
                        print(f"[remotion] Lugar geocodificado: '{_place}' -> lon/lat "
                              f"({_ll[0]:.2f},{_ll[1]:.2f})", flush=True)
                except Exception:
                    _c = None
            if not _c:
                _c = country_centroid(_country, (-180, -90, 180, 90))
            if _c:
                ev["targetX"], ev["targetY"] = _c
            if not str(ev.get("flag") or "").strip():
                _iso = country_iso2(_country)
                if _iso:
                    ev["flag"] = f"https://flagcdn.com/w160/{_iso}.png"
            if not str(ev.get("locName") or "").strip():
                ev["locName"] = _country[:40]
            print(f"[remotion] Mapa auto-resuelto para '{_country}' (NASA mundial + bandera)", flush=True)
        except Exception as _e:
            print(f"[remotion] Aviso: auto-resolve de mapa falló ({str(_e)[:100]})", flush=True)
    ev["image"] = _img
    # Etiqueta CORTA: "Normandía, Francia" → "Normandía" (el país ya lo dice la bandera).
    _ln = str(ev.get("locName") or "").strip() or str(ev.get("title") or "").strip()
    if "," in _ln:
        _ln = _ln.split(",")[0].strip()
    if _ln:
        ev["locName"] = _ln[:40]
    return _country, bounds


def _map_outline(scene: dict):
    """Contorno del país (fronteras GeoJSON) proyectado en el mapa, si la escena da el país
    (motion_country) y los LÍMITES del mapa (motion_map_bounds=[lonMin,latMin,lonMax,latMax],
    el mapa debe ser EQUIRECTANGULAR). Devuelve [] si falta info o no se encuentra el país."""
    country = (scene.get("motion_country") or scene.get("country") or "").strip()
    bounds = scene.get("motion_map_bounds") or scene.get("map_bounds")
    if not country or not bounds or len(list(bounds)) != 4:
        return []
    try:
        from scripts.geo_outline import outline_points
        return outline_points(country, tuple(float(x) for x in bounds), max_points=220)
    except Exception:
        return []


def _number_pos_ratio(text: str):
    """Posición (0..1) de la PRIMERA cifra dentro de la frase: dígito o palabra-número ES.
    Devuelve None si no hay ninguna. Sirve para arrancar el count-up de modo que ATERRICE
    cuando la voz dice el número (antes empezaba en el corte → contaba demasiado pronto)."""
    t = _strip_accents((text or "").lower())
    if not t.strip():
        return None
    best = None
    md = re.search(r"\d", t)
    if md:
        best = md.start()
    for wm in re.finditer(r"[a-z%]+", t):
        w = wm.group(0)
        if w == "%" or w in _NUM_WORDS_ALL:
            if best is None or wm.start() < best:
                best = wm.start()
            break  # finditer está ordenado → primera palabra-número es la más temprana
    if best is None:
        return None
    return max(0.0, min(1.0, best / max(1, len(t))))


def _words(text: str) -> list[str]:
    stop = {
        "para", "pero", "como", "esta", "este", "esto", "todo", "toda",
        "cuando", "donde", "porque", "entonces", "tambien", "también",
        "hacer", "hecho", "debe", "deben", "puede", "pueden", "algo",
        "vale", "pues", "digamos", "desde", "hasta", "sobre", "entre",
        "audio", "video", "vídeo",
    }
    out = []
    for w in re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+", text or ""):
        lw = w.lower()
        if len(lw) >= 4 and lw not in stop:
            out.append(w)
    return out


def _title_from_text(text: str, max_words: int = 4) -> str:
    nums = re.findall(r"\b(?:top\s*)?\d+[\wºª]*\b", text or "", flags=re.I)
    if nums:
        return nums[0].upper()
    words = _words(text)
    if not words:
        return _plain(text)[:48] or "Momento clave"
    return " ".join(words[:max_words])[:64]


def _num_title(text: str) -> str:
    """SOLO una cifra/fecha del texto (para stat/date). NUNCA las primeras palabras del
    SRT: eso fabricaba rótulos basura y MAL TRANSCRITOS ('Estén meditando a Valencia').
    Fix 2026-07-13 (el usuario): el rótulo sale del motion_title CURADO del planner, o de
    un dato numérico; si no hay, '' → metraje limpio (estilo BeyondMilitary)."""
    nums = re.findall(r"\b(?:top\s*)?\d+[\wºª]*\b", text or "", flags=re.I)
    return nums[0].upper() if nums else ""


def _looks_wrong_language_title(title: str, lang: str) -> bool:
    """¿El rótulo está en un idioma DISTINTO al del vídeo? (el usuario 2026-07-13: '2ª FUGA'
    en un vídeo en inglés queda fatal). Bidireccional: es→marca inglés, en/pt→marca español."""
    l = (lang or "").lower()
    t = title or ""
    words = {w.lower() for w in re.findall(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]+", t)}
    if l == "es":
        english_markers = {
            "video", "flow", "editing", "process", "steps", "workflow", "static",
            "image", "motion", "cheap", "visual", "documentary", "timeline",
            "escape", "prison", "war", "death", "secret", "government",
        }
        return bool(words & english_markers) and not any(
            w in words for w in {"flujo", "proceso", "imagen", "movimiento", "pasos"}
        )
    if l in ("en", "pt"):
        # Español en un vídeo en inglés/portugués: ¿¡, ordinal "2ª", o palabras claramente ES.
        # OJO: los ACENTOS por sí solos NO marcan idioma equivocado — los NOMBRES PROPIOS llevan
        # tildes en cualquier idioma ('Joaquín "El Chapo" Guzmán' en un vídeo en inglés es CORRECTO
        # y no debe vaciarse). Se juzga por signos ¿¡ / ordinal o por palabras españolas, no por tildes.
        if re.search(r"[¿¡]|\d\s*ª", t):
            return True
        es_markers = {
            "fuga", "fugas", "guerra", "gobierno", "ejercito", "ejército", "muerte",
            "secreto", "años", "numero", "número", "victima", "víctima", "carcel",
            "cárcel", "segunda", "primera", "asalto", "ataque", "frontera",
        }
        return bool(words & es_markers)
    return False


def _proper_noun_label(text: str) -> str:
    """Extrae un NOMBRE PROPIO real (persona/lugar) de la narración para rotular una escena que el
    planner dejó 'none' — NUNCA un fragmento de las primeras palabras del SRT (eso fabricaba basura
    tipo 'Estén meditando a Valencia'). Exige ≥2 tokens Capitalizados consecutivos, admitiendo
    partículas internas ('El Chapo', 'Al Capone', 'von Braun'). Una sola palabra suelta (un mes, un
    inicio de frase) NO cuenta → '' = metraje limpio. Genérico (cualquier nicho/idioma)."""
    if not text:
        return ""
    _PARTS = {"el", "la", "los", "las", "de", "del", "van", "von", "al", "bin", "da", "di", "the", "of"}
    for _snt in re.split(r"(?<=[.!?])\s+", str(text)):
        toks = _snt.split()
        seq: list[str] = []
        best: list[str] = []
        for j, w in enumerate(toks):
            cw = re.sub(r"[^\wÁÉÍÓÚÑÜáéíóúñü]", "", w)
            is_cap = bool(re.match(r"^[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{1,}$", cw))
            is_part = bool(seq) and cw.lower() in _PARTS
            if j >= 1 and (is_cap or is_part):
                seq.append(cw)
                # el "mejor" tramo = el que más tokens NO-partícula capitaliza
                if len([x for x in seq if x.lower() not in _PARTS]) > len([x for x in best if x.lower() not in _PARTS]):
                    best = list(seq)
            else:
                seq = []
        # limpia SÓLO conectores en minúscula colgando en los extremos ('...of', 'de ...') —
        # una partícula CAPITALIZADA es parte del nombre ('El' en 'El Chapo') y se conserva.
        while best and best[0].islower() and best[0].lower() in _PARTS:
            best = best[1:]
        while best and best[-1].islower() and best[-1].lower() in _PARTS:
            best = best[:-1]
        _proper = [x for x in best if x.lower() not in _PARTS]
        if len(best) >= 2 and len(_proper) >= 1:
            return _plain(" ".join(best))[:40]
    return ""


def _rank_from_text(text: str, fallback: int) -> int:
    """Rank REAL extraído del texto (#N, top N, puesto N). 0 si no hay → así no se
    inventan ranks (antes devolvía índice+1 → "#15" sin sentido en escenas normales)."""
    m = re.search(r"(?:^|\b)(?:#|top\s+|n[uú]mero\s+|puesto\s+|punto\s+)(\d{1,2})(?:\b|$)", text or "", flags=re.I)
    if m:
        try:
            return max(1, min(99, int(m.group(1))))
        except ValueError:
            pass
    return 0


def _items_from_text(text: str, fallback: list[str]) -> list[str]:
    chunks = re.split(r",|\by luego\b|\bluego\b|\bdespues\b|\bdespués\b|\buna vez\b|\by\b", text or "", flags=re.I)
    items = []
    for chunk in chunks:
        label = _title_from_text(chunk, 3)
        if label and len(label) >= 3:
            items.append(label)
    clean = []
    for item in items:
        key = item.lower()
        if key not in {x.lower() for x in clean}:
            clean.append(item)
    return (clean or fallback)[:5]


def _motion_items(scene: dict, text: str, fallback: list[str]) -> list[str]:
    raw = scene.get("motion_items") or scene.get("items") or scene.get("bullets") or []
    if isinstance(raw, list):
        clean: list[str] = []
        for item in raw:
            label = _plain(item)[:38]
            if label and label.lower() not in {x.lower() for x in clean}:
                clean.append(label)
        if clean:
            return clean[:5]
    return _items_from_text(text, fallback)


# Palabras que delatan una JERARQUÍA/PIRÁMIDE real (líder→base, rangos, niveles). Genérico: no
# se fabrica pirámide donde no hay lista de niveles; solo se ELEVA un tipo cuando la escena YA trae
# 3-5 items Y el texto/diseño habla de niveles/rangos/estructura piramidal.
_HIERARCHY_RE = re.compile(
    r"\b(jerarqu[íi]a|jer[áa]rquic|pir[áa]mide|piramidal|nivel(?:es)?|rango|rangos|escalaf[óo]n|"
    r"escala|estrato|estratos|cascada|c[úu]pula|l[íi]der(?:es)?|lugartenient|subordinad|"
    r"cadena de mando|estructura|organigrama|"
    r"hierarch\w*|pyramid|tier|tiers|rank(?:s|ing)?|level(?:s)?|echelon|chain of command|"
    r"top of|bottom of|lieutenant|underboss|foot soldier|leadership|org chart)\b",
    re.I)


_PYRAMID_TYPES = {"pyramid", "hierarchy", "tiers", "org_chart", "pyramid_diagram"}


def _looks_hierarchical(scene: dict, text: str) -> bool:
    """¿La escena describe una jerarquía/pirámide REAL? Exige (a) 3-5 items reales y (b) señales de
    nivel/rango/estructura en el texto o en motion_design/purpose. Sin ambas, no se piramidiza."""
    raw = scene.get("motion_items") or scene.get("items") or scene.get("bullets") or []
    n = len([x for x in raw if str(x).strip()]) if isinstance(raw, list) else 0
    if n < 3 or n > 5:
        return False
    blob = f"{text} {scene.get('motion_design') or ''} {scene.get('motion_purpose') or ''}"
    return bool(_HIERARCHY_RE.search(blob))


# ── ESQUEMA EN CORTE (cutaway) por VENTANA DE ESCENAS ────────────────────────────────────
# Las "escenas" del pipeline son FRAGMENTOS de frase (el SRT parte la narración), así que NINGUNA
# escena describe la estructura COMPLETA: "…led to a tunnel nearly a mile long," / "complete with
# lighting, ventilation, and" / "a motorcycle mounted on rails." → el cue de _event_type nunca veía
# la estructura Y sus partes a la vez, y la escena que SÍ dice "túnel" venía FORZADA a stat_big por
# el planner → el esquema no se disparaba NUNCA. Estas piezas miran una VENTANA de 2-5 escenas
# SEGUIDAS a partir de la escena del cue: si su texto COMBINADO enumera ≥2 partes reales, sale UN
# cross_section para toda la ventana. Genérico (ES+EN, cualquier nicho); sin ventana válida no se
# emite nada (cero invención). Se busca sobre el texto CRUDO con re.I → los índices de los cortes
# valen tal cual (sin desalinear tildes) y las etiquetas conservan sus acentos.
_CUT_CUE_RE = re.compile(
    r"\b(?:t[úu]nel(?:es)?|tunnels?|subterr[áa]ne[oa]s?|underground|excav\w*|galer[íi]as?|"
    r"b[úu]nker(?:es)?|bunkers?|shafts?|s[óo]tanos?|cutaway|cross[- ]?sections?|"
    r"corte transversal|secci[óo]n transversal)\b", re.I)
# Sustantivos de ESTRUCTURA (de los que SÍ se puede derivar un título). El cue admite además
# verbos ("excavó/excavated") y términos técnicos, que NO son un nombre de estructura.
_CUT_NOUN_RE = re.compile(
    r"\b(?:t[úu]nel(?:es)?|tunnels?|b[úu]nker(?:es)?|bunkers?|galer[íi]as?|s[óo]tanos?|"
    r"shafts?|subterr[áa]ne[oa]s?)\b", re.I)
# Conector de ENUMERACIÓN de partes ("complete with X, Y and Z" / "con X, Y y Z"): la marca
# lingüística de "la estructura Y sus partes". Sin conector NO hay lista de partes → no se
# inventa ninguna (evita colar "nearly a mile long" como si fuera una parte).
_CUT_PARTS_CONN_RE = re.compile(
    r"\b(?:complete with|equipped with|fitted with|outfitted with|filled with|including|"
    r"featuring|equipad[oa] con|dotad[oa] de|provist[oa] de|que inclu[íi]a|incluyendo|"
    r"complet[oa] con|with|con)\b", re.I)
_CUT_SPLIT_RE = re.compile(r"\s*(?:,|;|\band\b|\by\b|\be\b|&|\+)\s*", re.I)
_CUT_DET_RE = re.compile(
    r"^(?:an?|the|its|his|her|their|our|some|un|una|unos|unas|el|la|los|las|su|sus)\s+", re.I)
_CUT_MEASURE_RE = re.compile(
    r"\d[\d.,]*\s?(?:km|kil[óo]metros?|kilometers?|millas?|miles?|mi|m|metros?|meters?|"
    r"pies|feet|ft|yardas?|yards?)\b", re.I)
# Palabras que NO son un modificador del sustantivo ("a tunnel" → 'a' no describe el túnel).
_CUT_STOP_MOD = {
    "the", "this", "that", "these", "those", "his", "her", "its", "their", "our", "one", "two",
    "into", "onto", "from", "through", "under", "below", "beneath", "inside", "out", "of", "and",
    "or", "was", "were", "had", "has", "have", "long", "wide", "deep", "new", "old",
    "los", "las", "una", "unos", "unas", "del", "por", "para", "con", "esa", "ese", "este",
    "esta", "sus", "hacia", "bajo", "dentro", "desde", "hasta", "que", "largo", "ancho",
    "profundo", "nuevo", "viejo",
}
# Una ventana NO pisa un MAPA (curado por el planner o forzado por el pase de ubicaciones): es
# otra pieza grande de pantalla completa y el mapa manda en su escena.
_CUT_SKIP_MOTIONS = {"map_zoom", "cloud_map", "map_descend", "map_route", "map_callout", "map"}


def _is_measure_only(text: str) -> bool:
    """'1.5 km' / '10 m' / '300' = una COTA, no un título: el esquema ya la dibuja como cota
    (y de título quedaría un resaltador con un número suelto)."""
    return bool(re.fullmatch(r"[~≈<>≥≤]?\s*\d[\d.,]*\s*(?:[^\W\d_]{1,12}\.?)?", _plain(text)))


def _cut_part_label(chunk: str) -> str:
    """Etiqueta LIMPIA y corta de una PARTE ('a motorcycle mounted on rails' → 'Motorcycle on
    rails'). '' si el trozo no es una parte (vacío, la propia estructura, o una frase larga)."""
    s = _plain(chunk)
    s = re.sub(r"^[\s\-–—•·]+", "", s)
    s = re.sub(r"[\s,;:.!?…]+$", "", s)
    s = _CUT_DET_RE.sub("", s).strip()
    if len(s) < 3 or not re.search(r"[^\W\d_]", s) or _CUT_CUE_RE.search(s):
        return ""          # la estructura no es una "parte" de sí misma
    if len(s.split()) > 6:
        return ""          # una frase entera no es una etiqueta
    # Etiqueta CORTA (CrossSection hace shortCopy(…, 3 palabras)): fuera el participio de
    # sujeción antes de la preposición ('motorcycle mounted on rails' → 'motorcycle on rails').
    if len(s.split()) > 3:
        s = re.sub(r"\s+[^\W\d_]+(?:ed|ado|ada|ido|ida)\s+(?=(?:on|in|over|under|to|at|with|"
                   r"sobre|en|bajo|a|con|de)\b)", " ", s, flags=re.I).strip()
    if len(s.split()) > 4:
        return ""
    return (s[0].upper() + s[1:])[:34]


def _cutaway_parts(blob: str, cue_end: int) -> list[str]:
    """Partes REALES enumeradas TRAS la estructura, en LA MISMA frase ("complete with lighting,
    ventilation, and a motorcycle mounted on rails" → 3). Sin conector de enumeración → []."""
    for conn in _CUT_PARTS_CONN_RE.finditer(blob, cue_end):
        # las partes se enumeran en la misma frase (el punto corta; '1.5' no es fin de frase)
        tail = re.split(r"(?<!\d)[.!?…]", blob[conn.end():])[0]
        parts: list[str] = []
        for chunk in _CUT_SPLIT_RE.split(tail):
            label = _cut_part_label(chunk)
            if label and label.lower() not in {p.lower() for p in parts}:
                parts.append(label)
                if len(parts) >= 5:
                    break
        if len(parts) >= 2:
            return parts
    return []


def _cut_noun_label(blob: str, lang: str) -> str:
    """Nombre CORTO de la estructura derivado del propio texto: artículo + sustantivo que dice el
    guion, con su modificador REAL si lo hay ('The escape tunnel' / 'El túnel de escape'). Nunca
    añade hechos: si el guion solo dice "tunnel", sale "The tunnel"."""
    m = _CUT_NOUN_RE.search(blob)
    if not m:
        return ""          # el cue era un verbo/término técnico → sin nombre de estructura
    noun = _plain(m.group(0))
    code = (lang or "es").strip()[:2].lower()
    if code == "en":
        pre = re.search(r"\b([^\W\d_]{3,})\s+" + re.escape(noun) + r"\b", blob, re.I)
        mod = _plain(pre.group(1)) if pre and _norm_low(pre.group(1)) not in _CUT_STOP_MOD else ""
        return _plain(f"The {mod} {noun}")
    post = re.search(re.escape(noun) + r"\s+(?:de|del)\s+([^\W\d_]{3,})\b", blob, re.I)
    phrase = _plain(post.group(0)) if post and _norm_low(post.group(1)) not in _CUT_STOP_MOD else noun
    if code == "es":
        art = "La" if _norm_low(noun).startswith(("galeria", "seccion")) else "El"
        return _plain(f"{art} {phrase}")
    return _plain(phrase[:1].upper() + phrase[1:])


def _cutaway_measures(scenes: list[dict], i0: int, i1: int, blob: str, lang: str) -> str:
    """Medidas REALES de la ventana ('1.5 km', '10 m'), del texto y de los motion_title/subtitle
    curados. Viajan en el SUBTÍTULO porque CrossSection (_grab) saca de ahí las COTAS de longitud
    y profundidad; sin medidas en el guion, el esquema no dibuja cotas (no se inventan)."""
    sources = [blob]
    for j in range(i0, i1 + 1):
        sources.append(_plain(scenes[j].get("motion_title") or ""))
        sources.append(_plain(scenes[j].get("motion_subtitle") or ""))
    out: list[str] = []
    for src in sources:
        for m in _CUT_MEASURE_RE.finditer(src):
            value = _plain(m.group(0))
            if value.lower() not in {x.lower() for x in out}:
                out.append(value)
    if (lang or "es").lower().startswith("es"):
        # miles a la española ("1,400 metros" → "1.400 metros"), igual que los rótulos.
        out = [re.sub(r"(?<=\d),(?=\d{3}\b)", ".", v) for v in out]
    return " · ".join(out[:3])


def _cutaway_window(scenes: list[dict], lang: str = "es", max_span: int = 5) -> dict | None:
    """VENTANA de 2-5 escenas SEGUIDAS que describen una estructura en corte Y sus partes.
    Arranca en la escena que nombra la estructura (el cue) y se extiende hasta recoger el mayor
    número de partes (a igualdad, la ventana más CORTA). Devuelve {i0,i1,title,subtitle,items}
    o None → sin ventana válida el resto del pipeline no cambia en nada."""
    scenes = scenes or []
    for i0, scene in enumerate(scenes):
        if not _CUT_CUE_RE.search(_plain(scene.get("text") or "")):
            continue
        best: tuple[int, list[str], str] | None = None
        for span in range(2, max_span + 1):
            i1 = i0 + span - 1
            if i1 >= len(scenes):
                break
            if any((scenes[j].get("motion") or "").strip().lower() in _CUT_SKIP_MOTIONS
                   for j in range(i0, i1 + 1)):
                break      # hay un MAPA dentro: manda el mapa, no el esquema
            blob = _plain(" ".join(_plain(scenes[j].get("text") or "") for j in range(i0, i1 + 1)))
            cue = _CUT_CUE_RE.search(blob)
            if not cue:
                continue
            parts = _cutaway_parts(blob, cue.end())
            if len(parts) >= 2 and (best is None or len(parts) > len(best[1])):
                best = (i1, parts, blob)
        if best:
            i1, parts, blob = best
            # TÍTULO: el CURADO del planner en la ventana (si alguna escena lo trae y no es una
            # simple medida); si no, el nombre derivado del propio guion.
            title = ""
            for j in range(i0, i1 + 1):
                raw = _plain(scenes[j].get("motion_title") or "")
                if raw and not _is_measure_only(raw) and not _looks_wrong_language_title(raw, lang):
                    title = raw[:48]
                    break
            return {"i0": i0, "i1": i1, "items": parts[:5],
                    "title": title or _cut_noun_label(blob, lang),
                    "subtitle": _cutaway_measures(scenes, i0, i1, blob, lang)}
    return None


# ── GRÁFICA DE BARRAS por VENTANA DE ESCENAS (2026-07-17) ────────────────────────────────
# El usuario quiere "alguna gráfica, algo que se vea"… pero añadió "en caso que no [se pueda], lo
# dejamos así". Traducción: la gráfica sale SOLO si la narración trae cantidades REALES que se
# puedan comparar. CERO INVENCIÓN — sin datos, no se emite nada (y video.tsx tiene su propia
# salvaguarda: chartBarsReal descarta el <Chart> si no llegan ≥2 barras de verdad).
#
# Igual que el esquema en corte, se mira una VENTANA de escenas seguidas: las "escenas" son
# FRAGMENTOS de frase del SRT, así que "400 toneladas en 2001" y "900 en 2015" caen en escenas
# distintas y ninguna basta por sí sola (ver _cutaway_window, mismo patrón).
#
# Tres detectores, todos de ALTA precisión (mejor no sacar gráfica que sacar una inventada):
#   D1 SERIE POR AÑOS   — "400 tons in 2001 … 900 tons in 2015"  (etiqueta = el año)
#   D2 PORCENTAJES      — "el 60% de los hombres … el 25% de las mujeres" (etiqueta = el sujeto)
#   D3 ENTIDAD + UNIDAD — "Colombia produjo 400 toneladas, Perú 200" (etiqueta = la entidad)
# En los tres se exige la MISMA MAGNITUD y la MISMA UNIDAD (kind) → las barras son comparables y
# los números se pintan tal cual los dice el guion (nada de normalizar 2 millones vs 500 mil).
_CHART_MULT_RE = (r"(millones|mill[oó]n|millions?|mil millones|billions?|billones?|"
                  r"miles de millones|thousands?|miles|mil|bn|k)")
# La unidad es UNA palabra, opcionalmente "X de/of Y" ("toneladas de cocaína", "tons of cocaine").
# Sin ese límite se tragaba lo que viniera detrás ("400 tons that year" → unidad 'tons that year')
# y entonces no casaba con "200 tons" → la misma magnitud parecía incomparable y no salía gráfica.
_CHART_UNIT_RE = r"([^\W\d_]{1,14}(?:\s+(?:of|de|del)\s+[^\W\d_]{2,14})?)"
_CHART_YEAR_RE = r"((?:1[5-9]|20)\d{2})"
# Palabras que NO son una unidad ni una etiqueta válida (verbos/conectores frecuentes tras la
# cifra). Sin esto, "400 were seized" daría la unidad 'were'.
_CHART_STOP_UNIT = {
    "de", "del", "la", "el", "los", "las", "un", "una", "y", "e", "o", "u", "en", "a", "al",
    "que", "se", "es", "son", "era", "eran", "fue", "fueron", "habia", "había", "hay", "por",
    "the", "of", "a", "an", "and", "or", "in", "on", "at", "to", "was", "were", "is", "are",
    "had", "has", "have", "been", "be", "it", "its", "their", "his", "her", "more", "than",
    "mas", "más", "menos", "casi", "unos", "unas", "sobre", "para", "con", "sin", "como",
}
# Meses/días: capitalizados pero NO son entidades comparables (evita "July 400" de una fecha).
_CHART_STOP_LABEL = {
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
    "setiembre", "octubre", "noviembre", "diciembre", "lunes", "martes", "miercoles", "miércoles",
    "jueves", "viernes", "sabado", "sábado", "domingo",
    "january", "february", "march", "april", "may", "june", "july", "august", "september",
    "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday",
    "saturday", "sunday",
}


def _chart_num(raw: str):
    """'1.400'/'1,400' → 1400.0 · '1.5'/'1,5' → 1.5. MISMA regla que chartBars (video.tsx), así
    el número que parsea el render es EXACTAMENTE el que validó Python."""
    s = re.sub(r"[.,](?=\d{3}\b)", "", (raw or "").strip()).replace(",", ".")
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v > 0 else None


def _chart_unit_kind(mult: str, unit: str) -> str:
    """Clave de COMPARABILIDAD: misma magnitud + misma unidad. '' si la unidad no vale."""
    u = _norm_low(unit or "").strip()
    u = re.split(r"\s+(?:de|del|of)\s+", u)[0].strip()
    if u and (u in _CHART_STOP_UNIT or len(u) < 2):
        return ""
    # plural/singular a la misma clave ('toneladas'/'tonelada', 'tons'/'ton')
    u = re.sub(r"(?:es|s)$", "", u)
    return f"{_norm_low(mult or '')}|{u}"


def _chart_label_ok(label: str) -> bool:
    l = _norm_low(label or "").strip()
    return bool(l) and l not in _CHART_STOP_LABEL and l not in _CHART_STOP_UNIT and len(l) <= 16


def _chart_series(blob: str) -> tuple:
    """Devuelve (bars, unit_text) con las cantidades REALES comparables del texto, o ([], '').
    bars = [(etiqueta, texto_de_la_cifra)] — la cifra se conserva TAL CUAL la dice el guion."""
    txt = _plain(blob or "")
    if not txt:
        return [], ""

    def _pack(rows):
        """rows = [(label, display, kind, unit_text)] → agrupa por kind y valida."""
        by: dict = {}
        for lab, disp, kind, utxt in rows:
            if not _chart_label_ok(lab) or _chart_num(disp) is None:
                continue
            by.setdefault(kind, []).append((lab, disp, utxt))
        for kind, rows2 in sorted(by.items(), key=lambda kv: -len(kv[1])):
            seen, bars, utxt = set(), [], ""
            for lab, disp, u in rows2:
                if _norm_low(lab) in seen:
                    continue
                seen.add(_norm_low(lab))
                bars.append((lab, disp))
                utxt = utxt or u
                if len(bars) >= 5:
                    break
            vals = [_chart_num(d) for _, d in bars]
            # ≥2 etiquetas distintas y valores que NO sean todos iguales (una gráfica de barras
            # planas no compara nada).
            if len(bars) >= 2 and len(set(vals)) >= 2:
                return bars, utxt
        return [], ""

    # ── D1 — SERIE POR AÑOS: "400 tons in 2001" / "in 2001, 400 tons were seized" ──────────
    rows = []
    for m in re.finditer(r"(?<![\w.,])(\d[\d.,]*)\s*" + _CHART_MULT_RE + r"?\s*" + _CHART_UNIT_RE
                         + r"?\s*(?:in|en|para|by|hacia|durante|del?)\s+" + _CHART_YEAR_RE,
                         txt, re.I):
        rows.append((m.group(4), m.group(1), _chart_unit_kind(m.group(2), m.group(3)),
                     _plain(f"{m.group(2) or ''} {m.group(3) or ''}")))
    for m in re.finditer(r"\b(?:in|en|para|by|hacia|durante|desde|from)\s+" + _CHART_YEAR_RE
                         + r"\D{0,32}?(?<![\w.,])(\d[\d.,]*)\s*" + _CHART_MULT_RE + r"?\s*"
                         + _CHART_UNIT_RE + r"?", txt, re.I):
        rows.append((m.group(1), m.group(2), _chart_unit_kind(m.group(3), m.group(4)),
                     _plain(f"{m.group(3) or ''} {m.group(4) or ''}")))
    # un año NO puede ser a la vez etiqueta y valor de su propia barra
    rows = [r for r in rows if r[0] != r[1]]
    bars, utxt = _pack(rows)
    if bars:
        return bars, utxt

    # ── D2 — PORCENTAJES con sujeto: "el 60% de los hombres" / "60% of adults" ─────────────
    rows = []
    for m in re.finditer(r"(?<![\w.,])(\d[\d.,]*)\s*(?:%|por ciento|percent)\s*"
                         r"(?:de|of|del)\s+(?:los|las|la|el|un|una|the|all)?\s*"
                         r"([^\W\d_]{3,16})", txt, re.I):
        rows.append((_plain(m.group(2)), m.group(1), "|%", "%"))
    bars, _u = _pack(rows)
    if bars:
        return bars, "%"

    # ── D3 — ENTIDAD + UNIDAD: "Colombia produjo 400 toneladas" / "…, Perú 200 toneladas" ──
    rows = []
    for m in re.finditer(r"\b([A-ZÁÉÍÓÚÑ][^\W\d_]{2,15})\b"
                         r"[^.!?…\d]{0,20}?(?<![\w.,])(\d[\d.,]*)\s*" + _CHART_MULT_RE + r"?\s*"
                         + _CHART_UNIT_RE + r"?", txt):
        lab = _plain(m.group(1))
        # Una mayúscula que ABRE FRASE es POSICIONAL, no una entidad ("Beneath the drain, a
        # square opening…" → 'Beneath' no compara nada). Solo se acepta abriendo frase si es un
        # PAÍS del gazetteer (el caso clásico: "Colombia produjo X. Perú produjo Y."). El resto
        # de aperturas se descartan → cero etiquetas fabricadas.
        _pre = txt[:m.start()].rstrip()
        if (not _pre or _pre[-1] in ".!?…") and _norm_low(lab) not in _COUNTRY_EN \
                and lab not in _COUNTRY_EN_SET:
            continue
        kind = _chart_unit_kind(m.group(3), m.group(4))
        # ⚠ _chart_unit_kind devuelve '' (SIN '|') cuando la unidad no vale (stop-word tipo
        # "al"/"de", o <2 letras). Hacer split('|')[1] sobre '' reventaba con IndexError y,
        # como apply_remotion NO captura, se llevaba por delante TODO el render de motion.
        # Caso real: "movía 4.000 millones de dólares al año" ('al' es stop-unit).
        # '' significa exactamente "sin unidad" → es el mismo `continue` de siempre.
        if not kind or not kind.split("|")[1]:
            continue                       # sin unidad no hay comparación honesta
        rows.append((lab, m.group(2), kind,
                     _plain(f"{m.group(3) or ''} {m.group(4) or ''}")))
    return _pack(rows)


def _chart_is_timeseries(bars: list) -> bool:
    """¿La serie es una TENDENCIA en el tiempo? Sí cuando TODAS las etiquetas son AÑOS y hay ≥3
    puntos. Es el detector D1 (serie por años) visto desde el resultado.

    La FORMA de la gráfica la decide el DATO, no el planner ni el tema: años seguidos = una
    tendencia (línea, como la referencia 'INFLACIÓN ANUAL' del demo Vox); categorías/entidades/
    porcentajes = una comparación (barras, lo de siempre). Con 2 puntos NO hay tendencia que leer
    → se queda en barras. No añade ni un dato: son las MISMAS cifras validadas por _chart_series.
    """
    if len(bars) < 3:
        return False
    return all(re.fullmatch(r"(?:1[5-9]|20)\d{2}", str(lab).strip()) for lab, _disp in bars)


def _chart_window(scenes: list[dict], lang: str = "es", max_span: int = 4) -> dict | None:
    """VENTANA de 1-4 escenas SEGUIDAS cuyo texto COMBINADO trae ≥2 cantidades reales comparables.
    Devuelve {i0,i1,title,subtitle,items} o None (sin datos → el resto del pipeline no cambia)."""
    scenes = scenes or []
    best = None
    for i0 in range(len(scenes)):
        # La ventana ARRANCA en la escena del PRIMER dato (como el cue del esquema en corte). Sin
        # esto se tragaba las escenas mudas de delante: la gráfica entraba antes de que la voz
        # dijera la primera cifra y silenciaba overlays que no estorbaban.
        if not re.search(r"\d", _plain(scenes[i0].get("text") or "")):
            continue
        for span in range(1, max_span + 1):
            i1 = i0 + span - 1
            if i1 >= len(scenes):
                break
            if any((scenes[j].get("motion") or "").strip().lower() in _CUT_SKIP_MOTIONS
                   for j in range(i0, i1 + 1)):
                break      # hay un MAPA dentro: manda el mapa
            blob = _plain(" ".join(_plain(scenes[j].get("text") or "") for j in range(i0, i1 + 1)))
            bars, utxt = _chart_series(blob)
            if len(bars) >= 2 and (best is None or len(bars) > len(best[0])):
                best = (bars, utxt, i0, i1)
        if best:
            break          # la PRIMERA ventana válida del vídeo (una gráfica basta)
    if not best:
        return None
    bars, utxt, i0, i1 = best
    # TÍTULO: el CURADO del planner en la ventana; si no, la propia unidad ("Toneladas"); si el
    # guion no la nombra, el evento va sin título (jamás uno inventado).
    title = ""
    for j in range(i0, i1 + 1):
        raw = _plain(scenes[j].get("motion_title") or "")
        if raw and not _is_measure_only(raw) and not _looks_wrong_language_title(raw, lang):
            title = raw[:48]
            break
    unit = _plain(utxt).strip(" |")
    if not title and unit and unit != "%":
        title = unit[:1].upper() + unit[1:]
    # SERIE TEMPORAL → línea de tendencia. Los puntos van en orden CRONOLÓGICO (el guion puede
    # nombrar los años desordenados: "en 2010 … pero ya en 2001 …"); una línea con los años
    # descolocados contaría una tendencia FALSA. Las barras se dejan en el orden del guion (ahí
    # el orden no afirma nada).
    _line = _chart_is_timeseries(bars)
    if _line:
        bars = sorted(bars, key=lambda lb: int(lb[0]))
    return {"i0": i0, "i1": i1, "kind": "line" if _line else "bars",
            # items en el formato que parsea chartBars/chartBarsReal: "Etiqueta 400".
            "items": [f"{lab} {disp}{'%' if unit == '%' else ''}" for lab, disp in bars],
            "title": title[:48],
            # la UNIDAD real bajo el titular (sin ella los números no significan nada).
            "subtitle": (unit if unit and unit != "%" and unit.lower() != _norm_low(title) else "")[:60]}


# Mapeo de los tipos 3D "ae_*" (saturados/genéricos) a sus equivalentes LIMPIOS
# estilo VidRush. Se aplica salvo que el usuario pida premium (motion_style_hint AE/3D).
_CLEAN_TYPE_MAP = {
    "ae_documentary_rank": "ranking_card", "ae_specs_plate": "stat_wall",
    "ae_workflow_blueprint": "keyword_card", "ae_code_orchestrator": "keyword_card",
    "ae_object_rig": "keyword_card", "ae_device_scene": "keyword_card",
    "ae_floating_showcase": "keyword_card", "ae_kinetic_badge": "lower_third",
    "ae_data_orbit": "stat_wall", "ae_icon_burst": "keyword_card",
    "ae_3d_stack": "checklist", "ae_depth_title": "title_full",
    "ae_hud_panel": "keyword_card", "ae_prompt_terminal": "keyword_card",
    "ae_node_map": "process_flow", "ae_product_spotlight": "big_word",
}

# Los motion graphics deben ser overlays de texto SOBRE el b-roll real (estilo Elias
# Yoder / VidRush / el doc del amigo): lower-thirds, cifras, rankings, callouts. Los
# tipos "ae_*" 3D son escenas OPACAS full-screen (muñeco 3D, UI/IDE falsa con "RENDER
# ready", HUD…) que TAPAN el metraje y parecen un promo de SaaS → destrozan el look
# documental/real que el usuario pidió EXPRESAMENTE ("que parezca real, no cutre").
# Por eso se desactivan por defecto y se mapean a un overlay que deja ver el b-roll.
_OPAQUE_FAKE_TYPES = {
    "ae_depth_title", "ae_icon_burst", "ae_3d_stack", "ae_data_orbit",
    "ae_hud_panel", "ae_floating_showcase", "ae_prompt_terminal", "ae_node_map",
    "ae_product_spotlight", "ae_kinetic_badge", "ae_object_rig", "ae_device_scene",
    "ae_workflow_blueprint", "ae_code_orchestrator", "ae_documentary_rank",
    "ae_specs_plate",
}

# Composiciones editoriales que salen de la auditoría de ocho canales Vidrush.
# No son "skins" de un lower-third: cada una necesita una evidencia/asset real y
# una intención concreta del planner. El renderer TypeScript mantiene el catálogo
# cerrado para que el modelo no pueda inventar un panel o una interfaz genérica.
_VIDRUSH_MOTIONS = {
    "vidrush_evidence_matrix", "vidrush_dossier_compare", "vidrush_identity_cutout",
    "vidrush_inspector_lens", "vidrush_cross_section", "vidrush_field_profile",
    "vidrush_archive_date", "vidrush_evidence_gallery",
}
# Esquemas de ingeniería inspirados en Constructum. Son piezas fullscreen dibujadas desde
# datos del guion, no tarjetas genéricas ni assets IA: planta/alzado, solar, comparación de
# estructuras, proceso causal, línea temporal y jerarquía de cargas.
_SCHEMATIC_MOTIONS = {
    "engineering_schematic", "site_plan", "structure_compare", "process_flow",
    "timeline", "pyramid", "map_route",
}
# Overlays documentales (documentary-motion.tsx) que necesitan la FOTO/frame de la escena
# (se stagean como los vidrush; sin asset real degradan a rótulo).
_IMAGE_OVERLAYS = {
    "parts_diagram", "photo_inset", "photo_caption", "circle_compare", "subject_profile",
    "doc_highlight", "photo_strip",
}
# Overlays de texto que se ANCLAN al momento en que la voz dice su frase (como la cifra).
_PHRASE_ANCHOR_TYPES = {
    "narrative_text", "quote_card", "quote_line", "callout_label", "tag_label", "label_pair",
    "date_stamp", "caption_bar", "title_kicker", "stamp_word", "kinetic_words", "rank_badge",
    "year_dot", "topic_list", "photo_inset", "lower_third", "center_label", "glitch_number",
    "frame_box", "ticker_word", *_SCHEMATIC_MOTIONS,
}
_DOC_NEW_TYPES = {
    "echo_title", "callout_label", "label_pair", "date_stamp", "quote_card", "caption_bar",
    "tag_label", "title_kicker", "stamp_word", "kinetic_words", "parts_diagram", "topic_list",
    "photo_inset", "photo_caption", "year_timeline", "year_dot", "circle_compare",
    "subject_profile", "rank_badge", "doc_highlight",
    "ticker_word", "photo_strip", "center_label", "glitch_number", "frame_box",
}
# Composiciones que TAPAN el metraje (foto a pantalla completa): se acotan a ~5.5 s y se
# espacian (el usuario 2026-09-05: "dura demasiado", "yo solo pondría en un lado").
_FULLSCREEN_IMAGE_TYPES = _IMAGE_OVERLAYS | {
    "vidrush_evidence_matrix", "vidrush_dossier_compare", "vidrush_identity_cutout",
    "vidrush_inspector_lens", "vidrush_cross_section", "vidrush_field_profile",
    "vidrush_archive_date", "vidrush_evidence_gallery",
}
_DEACC_TABLE = str.maketrans("áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ",
                             "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC")


def _norm_words(s: str) -> list[str]:
    s = str(s or "").translate(_DEACC_TABLE).lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return [w for w in s.split() if w]


def _phrase_pos_ratio(text: str, phrase: str) -> float | None:
    """Posición (0..1) donde EMPIEZA `phrase` dentro de `text`, en palabras. Prueba con las
    3 primeras palabras de la frase, luego 2, luego 1 (si es 'rara': ≥5 letras o dígito).
    None si no aparece → el evento arranca en el corte como siempre."""
    tw = _norm_words(text)
    pw = _norm_words(phrase)
    if not tw or not pw:
        return None
    for n in (3, 2, 1):
        if len(pw) < n:
            continue
        head = pw[:n]
        if n == 1 and not (len(head[0]) >= 5 or head[0].isdigit()):
            continue
        for i in range(0, len(tw) - n + 1):
            if tw[i:i + n] == head:
                return i / max(1, len(tw))
    return None


def _phrase_speak_seconds(text: str, phrase: str, dur: float) -> float:
    """Segundos que tarda la voz en decir `phrase` dentro de una escena de `dur` s (proporción
    de palabras). Acotado a [0.8, 4.5]."""
    tw = len(_norm_words(text))
    pw = len(_norm_words(phrase))
    if tw <= 0 or pw <= 0 or dur <= 0:
        return 0.0
    return max(0.8, min(4.5, dur * pw / tw))


def validate_vidrush_events(events: list[dict], duration: float, public_dir: str | Path | None = None) -> list[str]:
    """QC determinista de las composiciones Vidrush antes de abrir Remotion.

    El QC de assets ocurre antes en el pipeline; aquí se comprueba el contrato final que va a
    montar Remotion: catálogo cerrado, evidencia real ya stageada, ventanas SRT completas y
    sin solapes. Devuelve motivos legibles para que el caller pueda pausar el montaje en vez
    de entregar un vídeo visualmente descuadrado.
    """
    errors: list[str] = []
    try:
        total = float(duration or 0)
    except (TypeError, ValueError):
        total = 0.0
    root = Path(public_dir).resolve() if public_dir else None

    def _asset_ok(raw: str) -> bool:
        value = str(raw or "").strip()
        if not value or "vidrush_reference_lab" in value.replace("\\", "/"):
            return False
        if value.startswith(("http:", "https:", "data:")):
            return True
        p = Path(value)
        if not p.is_absolute() and root:
            p = root / value
        try:
            return p.exists() and p.stat().st_size > 1024
        except OSError:
            return False

    checked = []
    for ev in events or []:
        if not isinstance(ev, dict):
            continue
        typ = str(ev.get("type") or "").strip()
        if typ not in _VIDRUSH_MOTIONS:
            continue
        ident = str(ev.get("id") or "?")
        try:
            start = float(ev.get("start", 0) or 0)
            dur = float(ev.get("duration", 0) or 0)
        except (TypeError, ValueError):
            errors.append(f"{ident}: tiempos no numéricos")
            continue
        if dur < 3.8 - 0.01:
            errors.append(f"{ident}: {dur:.2f}s < mínimo Vidrush 3.8s")
        if start < -0.01 or start + dur > total + 0.05:
            errors.append(f"{ident}: ventana {start:.2f}-{start + dur:.2f}s fuera de 0-{total:.2f}s")
        if not str(ev.get("title") or "").strip():
            errors.append(f"{ident}: falta motion_title")
        if not _asset_ok(ev.get("image")):
            errors.append(f"{ident}: evidencia primaria no stageada")
        if typ in {"vidrush_evidence_matrix", "vidrush_evidence_gallery"}:
            second = str(ev.get("image2") or "").strip()
            if not _asset_ok(second) or second == str(ev.get("image") or "").strip():
                errors.append(f"{ident}: {typ} exige segunda evidencia distinta")
        if typ == "vidrush_inspector_lens":
            for key in ("targetX", "targetY"):
                try:
                    value = float(ev.get(key, 0.5))
                except (TypeError, ValueError):
                    value = -1
                if not 0 <= value <= 1:
                    errors.append(f"{ident}: {key} fuera de 0..1")
        checked.append((start, start + dur, ident))

    checked.sort()
    for previous, current in zip(checked, checked[1:]):
        if previous[1] > current[0] + 0.04:
            errors.append(f"{previous[2]} solapa {current[2]} ({previous[1]:.2f}>{current[0]:.2f})")
    return errors


def validate_motion_windows(events: list[dict], scenes: list[dict] | None,
                            duration: float) -> list[str]:
    """Comprueba que cualquier overlay principal respeta la ventana de su escena.

    Los presets heredados (``stat_big``, ``lower_third``...) no pasan por el QC específico
    de Vidrush, pero deben obedecer exactamente el mismo contrato de SRT. El id determinista
    ``sN_main`` permite comparar el evento ya calculado con la escena original sin depender
    de texto ni de heurísticas visuales.
    """
    errors: list[str] = []
    by_idx: dict[int, dict] = {}
    for scene in scenes or []:
        if not isinstance(scene, dict):
            continue
        try:
            by_idx[int(scene.get("idx", len(by_idx)))] = scene
        except (TypeError, ValueError):
            continue
    _skip_overlap = {"film_burn", "section_flash", "transition"}
    checked: list[tuple[float, float, str]] = []
    total = max(0.0, float(duration or 0))
    for ev in events or []:
        if not isinstance(ev, dict):
            continue
        typ = str(ev.get("type") or "").strip()
        if not typ or typ in _skip_overlap:
            continue
        ident = str(ev.get("id") or "?")
        try:
            start = float(ev.get("start", 0) or 0)
            dur = max(0.0, float(ev.get("duration", 0) or 0))
        except (TypeError, ValueError):
            errors.append(f"{ident}: tiempos no numéricos")
            continue
        end = start + dur
        if start < -0.05 or end > total + 0.05:
            errors.append(f"{ident}: ventana {start:.2f}-{end:.2f}s fuera de 0-{total:.2f}s")
        match = re.match(r"^s(\d+)_", ident)
        if match:
            scene = by_idx.get(int(match.group(1)))
            if scene is not None:
                s0 = float(scene.get("start", 0) or 0)
                s1 = s0 + max(0.0, float(scene.get("duration", 0) or 0))
                if start < s0 - 0.06 or end > s1 + 0.06:
                    errors.append(f"{ident}: invade ventana SRT {s0:.2f}-{s1:.2f}s "
                                  f"(evento {start:.2f}-{end:.2f}s)")
        checked.append((start, end, ident))
    checked.sort()
    for (a0, a1, aid), (b0, b1, bid) in zip(checked, checked[1:]):
        if b0 < a1 - 0.06:
            errors.append(f"solape de overlays: {aid} {a0:.2f}-{a1:.2f}s / "
                          f"{bid} {b0:.2f}-{b1:.2f}s")
    return errors


def _locate_targets_with_vision(events: list[dict], video_path: str, project_id: str) -> None:
    """Sitúa targetX/targetY de callout_label / vidrush_inspector_lens / doc_highlight con el
    modelo de visión sobre el frame REAL. Sin acierto → callout_label pasa a tag_label."""
    if os.environ.get("MOTION_VISION_LOCATE", "1").strip().lower() not in {"1", "true", "yes", "on"}:
        return
    _targets = [e for e in events if str(e.get("type") or "") in
                {"callout_label", "vidrush_inspector_lens", "doc_highlight", "parts_diagram", "frame_box"}]
    if not _targets:
        return
    try:
        budget = int(os.environ.get("MOTION_VISION_LOCATE_MAX", "60") or 60)
    except (TypeError, ValueError):
        budget = 60
    strict = os.environ.get("MOTION_LOCATE_STRICT", "1").strip().lower() in {"1", "true", "yes", "on"}
    try:
        from app import qwen_client
    except Exception as exc:  # noqa: BLE001
        print(f"[remotion] locate: sin cliente de visión ({str(exc)[:80]})", flush=True)
        return
    tmp_dir = PUBLIC / "_locate"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    ok = miss = fail = 0
    for ev in _targets:
        if budget <= 0:
            break
        typ = str(ev.get("type") or "")
        label = str(ev.get("title") or "").strip()
        _parts = [str(x).strip() for x in (ev.get("items") or []) if str(x).strip()][:4] if typ == "parts_diagram" else []
        if typ == "parts_diagram" and not _parts:
            continue
        if not label and typ != "parts_diagram":
            continue
        frame_path = ""
        try:
            if typ in {"vidrush_inspector_lens", "doc_highlight", "parts_diagram"} and ev.get("image"):
                _img = str(ev["image"])
                frame_path = _img if os.path.isabs(_img) else str(PUBLIC / _img)
            else:
                t = float(ev.get("start", 0) or 0) + 0.6
                frame_path = str(tmp_dir / f"{_safe_project_id(project_id)}_{ev.get('id', 'ev')}.jpg")
                run = subprocess.run(
                    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(video_path),
                     "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "3", "-y", frame_path],
                    capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45)
                if run.returncode != 0 or not os.path.exists(frame_path):
                    frame_path = ""
        except Exception:
            frame_path = ""
        if not frame_path or not os.path.exists(frame_path):
            fail += 1
            if strict and typ == "callout_label":
                ev["type"] = "tag_label"
            continue
        if typ == "parts_diagram":
            # UNA llamada para todas las piezas: el modelo devuelve la posición de cada una;
            # las no visibles se descartan (el usuario: "que estén bien puestas las partes").
            _plist = "; ".join(f'"{p}"' for p in _parts)
            prompt = (
                f'This image shows an object with parts. Locate each of these parts: {_plist}. '
                'Reply ONLY with JSON: {"parts": [{"name": "...", "found": true, "x": 0.0-1.0, "y": 0.0-1.0}]} '
                'in the same order, where (x, y) is the CENTER of the part, x from left (0) to right (1), '
                'y from top (0) to bottom (1). Use "found": false for parts not clearly visible.'
            )
            budget -= 1
            try:
                r = qwen_client.chat_vision(prompt, [frame_path], max_tokens=1200, timeout=90)
                d = r if isinstance(r, dict) else {}
                if not d and isinstance(r, str):
                    m = re.search(r"\{.*\}", r, re.S)
                    d = json.loads(m.group(0)) if m else {}
                rows = d.get("parts") or []
                kept_items, kept_targets = [], []
                for k, p in enumerate(_parts):
                    row = rows[k] if k < len(rows) and isinstance(rows[k], dict) else {}
                    try:
                        fx, fy = float(row.get("x")), float(row.get("y"))
                    except (TypeError, ValueError):
                        fx = fy = None
                    if row.get("found") and fx is not None and fy is not None and 0 <= fx <= 1 and 0 <= fy <= 1:
                        kept_items.append(p)
                        kept_targets.append([round(min(0.97, max(0.03, fx)), 3), round(min(0.97, max(0.03, fy)), 3)])
                if len(kept_items) >= 2:
                    ev["items"] = kept_items
                    ev["targets"] = kept_targets
                    ok += 1
                    print(f"[remotion] locate piezas: {len(kept_items)}/{len(_parts)} situadas → {kept_items}", flush=True)
                else:
                    miss += 1
                    ev["type"] = "photo_caption"
                    print(f"[remotion] locate piezas: solo {len(kept_items)} visibles → photo_caption", flush=True)
            except Exception as exc:  # noqa: BLE001
                fail += 1
                ev["type"] = "photo_caption"
                print(f"[remotion] locate piezas: visión falló ({str(exc)[:70]}) → photo_caption", flush=True)
            continue
        # BOUNDING BOX en vez de centro: con "dame el centro" el modelo contestaba 0.5/0.5 por
        # defecto (banco v4: TELAR, CONVENTO, MOLE DE OLLA todos en el centro exacto). Con caja se
        # compromete más; si la caja cubre casi todo el frame no hay nada que señalar.
        prompt = (
            f'Find the object described as "{label}" in this image. '
            'Reply ONLY with JSON: {"found": true, "box": [x1, y1, x2, y2], "confidence": 0.0-1.0} '
            'where the box is the tight bounding box of that object in normalized coordinates '
            '(0,0 = top-left, 1,1 = bottom-right; x1<x2, y1<y2). '
            'If the object is not clearly visible, reply {"found": false}.'
        )
        budget -= 1
        try:
            # max_tokens generoso: MiniMax-M3 gasta tokens antes del JSON y con 120 la respuesta
            # llegaba truncada ('"confi…') → "vision sin JSON" en 8 de 12 (banco v3).
            r = qwen_client.chat_vision(prompt, [frame_path], max_tokens=900, timeout=75)
        except Exception as exc:  # noqa: BLE001
            fail += 1
            print(f"[remotion] locate '{label}': visión falló ({str(exc)[:70]})", flush=True)
            if strict and typ in {"callout_label", "frame_box"}:
                ev["type"] = "tag_label"
            continue
        found, x, y, conf = False, None, None, 0.0
        _box = None
        try:
            d = r if isinstance(r, dict) else {}
            if not d and isinstance(r, str):
                m = re.search(r"\{.*\}", r, re.S)
                d = json.loads(m.group(0)) if m else {}
            found = bool(d.get("found"))
            box = d.get("box") or d.get("bbox")
            if isinstance(box, (list, tuple)) and len(box) == 4:
                x1, y1, x2, y2 = (float(v) for v in box)
                if x1 > 1.5 or y1 > 1.5 or x2 > 1.5 or y2 > 1.5:   # píxeles → normalizar
                    x1, x2 = x1 / 960.0, x2 / 960.0
                    y1, y2 = y1 / 540.0, y2 / 540.0
                x1, x2 = min(x1, x2), max(x1, x2)
                y1, y2 = min(y1, y2), max(y1, y2)
                area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
                if area >= 0.82:
                    found = False   # "el objeto" es todo el frame: nada que señalar
                    print(f"[remotion] locate '{label}': la caja cubre {area:.0%} del frame → sin flecha", flush=True)
                else:
                    x, y = (x1 + x2) / 2.0, (y1 + y2) / 2.0
                    _box = [round(max(0.0, x1), 3), round(max(0.0, y1), 3), round(min(1.0, x2), 3), round(min(1.0, y2), 3)]
            elif d.get("x") is not None and d.get("y") is not None:
                x, y = float(d.get("x")), float(d.get("y"))
            conf = float(d.get("confidence") or 0.0)
        except Exception:
            found = False
        if found and x is not None and y is not None and 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 and conf >= 0.35:
            ev["targetX"] = round(min(0.95, max(0.05, x)), 3)
            ev["targetY"] = round(min(0.92, max(0.08, y)), 3)
            if typ == "frame_box":
                if _box and (_box[2] - _box[0]) >= 0.06 and (_box[3] - _box[1]) >= 0.06:
                    ev["box"] = _box
                else:
                    ev["type"] = "tag_label"
            ok += 1
            print(f"[remotion] locate '{label}' → ({ev['targetX']}, {ev['targetY']}) conf={conf:.2f}", flush=True)
        else:
            miss += 1
            if typ in {"callout_label", "frame_box"}:
                ev["type"] = "tag_label"
                print(f"[remotion] locate '{label}': no visible → etiqueta sin flecha", flush=True)
            elif typ == "vidrush_inspector_lens":
                ev["targetX"], ev["targetY"] = 0.5, 0.5
    print(f"[remotion] locate: {ok} situados · {miss} no visibles · {fail} fallos de visión", flush=True)


def _second_evidence(scene: dict, scenes: list, i: int, typ: str) -> str:
    """Segunda evidencia REAL para matriz/galería/dossier: ruta del plan si existe; si no, el
    asset (foto o clip) de la escena vecina más cercana distinto del principal. Nunca una
    imagen del laboratorio."""
    raw = str(scene.get("motion_image2") or scene.get("compare_image") or "").strip()
    if raw and (raw.startswith(("http:", "https:", "data:")) or os.path.exists(raw)):
        return raw
    if typ not in {"vidrush_evidence_matrix", "vidrush_evidence_gallery", "vidrush_dossier_compare",
                   "vidrush_field_profile", "circle_compare", "subject_profile", "photo_strip"}:
        return ""
    primary = str(scene.get("asset_path") or "").strip()
    for off in (1, -1, 2, -2, 3, -3, 4, -4):
        j = i + off
        if 0 <= j < len(scenes or []):
            cand = str((scenes[j] or {}).get("asset_path") or "").strip()
            if cand and cand != primary and os.path.exists(cand):
                return cand
    return ""


def _doc_overlay_clamp(typ: str, text: str, real_rank: int) -> str:
    """Mapea tipos OPACOS/falsos (ae_* 3D) a un overlay que deja ver el metraje real.
    Conserva el resto de tipos limpios (transparentes) para mantener variedad."""
    if typ not in _OPAQUE_FAKE_TYPES:
        return typ
    if real_rank and real_rank > 0:
        return "ranking_card"
    if re.search(r"\d", text or ""):
        return "stat_wall"
    return "lower_third"


def _event_type(text: str, index: int, total: int) -> str:
    forced = (text or "").strip()
    if forced in {
        "title_full", "process_flow", "checklist", "split_panel", "timeline",
        "big_word", "keyword_card", "lower_third", "quote", "ranking_card",
        "evidence_card", "map_callout", "before_after", "stat_wall",
        "avatar_safe_panel", "ae_icon_burst", "ae_3d_stack", "ae_data_orbit",
        "ae_depth_title", "ae_hud_panel", "ae_floating_showcase",
        "ae_prompt_terminal", "ae_node_map", "ae_product_spotlight",
        "ae_kinetic_badge", "ae_object_rig", "ae_device_scene",
        "ae_workflow_blueprint", "ae_code_orchestrator",
        "ae_documentary_rank", "ae_specs_plate",
        "stat_big", "chart", "section_title", "map_route",
        "map_zoom", "cloud_map", "map_descend",
        "engineering_schematic", "site_plan", "structure_compare", "process_flow",
        "timeline", "pyramid",
        # ESQUEMA en CORTE (cutaway/blueprint estilo Beyond Military): túnel, búnker,
        # sección de infraestructura, capas del subsuelo. GLM la pide para escenas de
        # construcción/profundidad/interior enterrado; las partes van en motion_items.
        "cross_section", "cutaway", "blueprint", "depth_section",
        "tunnel_section", "schematic",
        # PIRÁMIDE / JERARQUÍA (niveles anidados: líder→base, rangos, tiers). El planner la pide
        # con estos nombres; video.tsx la pinta con <Pyramid> (cae a SpecPanel/LowerThird si <2 items).
        "pyramid", "hierarchy", "tiers", "org_chart", "pyramid_diagram",
        # GRAMÁTICA VIDRUSH: composiciones narrativas, no tarjetas intercambiables.
        "vidrush_evidence_matrix", "vidrush_dossier_compare", "vidrush_identity_cutout",
        "vidrush_inspector_lens", "vidrush_cross_section", "vidrush_field_profile",
        "vidrush_archive_date", "vidrush_evidence_gallery",
        # TEXTO NARRATIVO con frases destacadas (estilo Firearms Vault / Eli Yoder):
        # texto grande sobre metraje con palabras clave en dorado.
        "narrative_text",
        # OVERLAYS EDITORIALES documentales (documentary-motion.tsx, 2026-09-05): calcados de
        # las referencias (Eli Yoder, American Secrets, Firearms Vault, Make Tech Future…).
        *_DOC_NEW_TYPES,
    }:
        return forced
    low = (text or "").lower()
    if re.search(r"\b(codex|workflow|pipeline|editor|codigo|code|terminal|prompt|prompts|remotion|render|export|interfaz|interface|dashboard|software|app)\b", low):
        return "ae_workflow_blueprint"
    # Ranking SOLO si es un listicle REAL (top N / #N / puesto N / mejores N). Antes
    # cualquier número (\d+) → ranking con rank = índice+1 → "#15" sin sentido.
    if re.search(r"(\btop\s*\d|#\s*\d|\bpuesto\s*\d|\bmejores\s*\d|\branking\b|\bn[uú]mero\s*\d)", low):
        return "ranking_card"
    # ESQUEMA en CORTE (cutaway) ANTES que stat_wall: una escena de túnel/subsuelo suele traer
    # una cifra ("1,5 km") que si no dispararía el número grande; el corte transversal cuadra
    # mejor. Solo con palabras fuertes de sección/subterráneo (no cualquier "construcción").
    # ⚠ Términos EN además de ES (2026-07-17): la lista era SOLO española, así que un guion en
    # inglés ("a tunnel nearly a mile long", "excavated", "dug for months") NUNCA disparaba el
    # esquema en corte — `t[úu]nel` no casa con "tunnel" (doble n) y `excav[óoa]\b` no casa con
    # "excavated". Con esto el esquema visual funciona en ES y EN (y en las traducciones).
    if re.search(r"\b(t[úu]nel|t[úu]neles|subterr[áa]neo|excav[óoa]|s[óo]tano|b[úu]nker|bunker|"
                 r"galer[íi]a|corte transversal|secci[óo]n transversal|vista en corte|"
                 r"capas del subsuelo|tunnels?|underground|excavat(?:e|ed|es|ing|ion)|"
                 r"cross[- ]section|cutaway)\b", low):
        return "cross_section"
    # stat_wall SOLO si hay un DÍGITO real que mostrar como número grande. Si el
    # número va escrito en palabras (trece, mil…), no hay dígito → titular limpio
    # (evita el "1" grande arbitrario).
    if re.search(r"(\d{2,4}|\d+\s*%|\b\d+\b)", low):
        return "stat_wall"
    if index == 0:
        return "title_full"
    if index == total - 1:
        return "quote"
    if re.search(r"\b(documento|archivo|prueba|evidencia|carta|foto|imagen|captura|registro|informe)\b", low):
        return "evidence_card"
    if re.search(r"\b(mapa|ruta|pais|pa[ií]s|ciudad|estado|zona|lugar|donde|ubicaci[oó]n|territorio|region|regi[oó]n)\b", low):
        return "map_callout"
    if re.search(r"\b(antes|despu[eé]s|cambio|comparaci[oó]n|versus|vs|problema|soluci[oó]n|mejora)\b", low):
        return "before_after"
    if re.search(r"\b(flujo|pipeline|proceso|paso|primero|luego|despu[eé]s|una vez|orden)\b", low):
        return "process_flow"
    if re.search(r"\b(verificar|prueba|comprobar|funciona|correctamente|listo)\b", low):
        return "checklist"
    if re.search(r"\b(causa|raz[oó]n|problema|soluci[oó]n|por qu[eé])\b", low):
        return "split_panel"
    return ["keyword_card", "lower_third", "big_word", "timeline"][index % 4]


# 🎛 FAMILIAS de overlay para que el usuario ACTIVE/DESACTIVE tipos desde la UI (el usuario
# 2026-07-30: "puedo decidir los tipos de motion graphics que haya"). Cada `type` concreto cae en
# una familia; el canal manda una lista de familias APAGADAS en env MOTION_TYPES_OFF (coma-sep) y
# aquí se filtra. Si un tipo cae en familia apagada, se degrada a 'lower_third' (o al panel), y si
# TAMBIÉN están apagados esos, la escena se queda SIN overlay (no se inventa nada).
_TYPE_FAMILY = {
    "lower_third": "lower_third",
    "title_full": "section", "section_title": "section",
    "keyword_card": "panel", "checklist": "panel", "split_panel": "panel",
    "process_flow": "panel", "avatar_safe_panel": "panel", "spec_panel": "panel",
    "big_word": "bigword", "quote": "bigword", "timeline": "bigword", "before_after": "bigword",
    "stat_wall": "stat", "stat_big": "stat", "big_stat": "stat", "hero_stat": "stat",
    "number_badge": "stat",
    "ranking_card": "ranking", "ae_documentary_rank": "ranking",
    "chart": "chart", "bar_chart": "chart", "graph": "chart", "line_chart": "chart",
    "map_zoom": "map", "cloud_map": "map", "map_descend": "map", "map_route": "map",
    "map_callout": "map", "map": "map", "geo_map": "map",
    "site_plan": "map",
    "cross_section": "diagram", "cutaway": "diagram", "blueprint": "diagram",
    "depth_section": "diagram", "tunnel_section": "diagram", "schematic": "diagram",
    "engineering_schematic": "diagram", "structure_compare": "diagram",
    "process_flow": "diagram", "timeline": "diagram",
    "evidence_card": "diagram",
    "pyramid": "diagram", "hierarchy": "diagram", "tiers": "diagram",
    "org_chart": "diagram", "pyramid_diagram": "diagram",
    # Toggle único porque son mecanismos del mismo lenguaje editorial; apagarlo
    # conserva el resto de mapas/datos sin degradar cada composición por separado.
    "vidrush_evidence_matrix": "editorial", "vidrush_dossier_compare": "editorial",
    "vidrush_identity_cutout": "editorial", "vidrush_inspector_lens": "editorial",
    "vidrush_cross_section": "editorial", "vidrush_field_profile": "editorial",
    "vidrush_archive_date": "editorial", "vidrush_evidence_gallery": "editorial",
    "narrative_text": "editorial",
    **{t: "editorial" for t in _DOC_NEW_TYPES},
}
_MOTION_TYPES_OFF_CACHE: dict = {}


def _disabled_families() -> set:
    """Familias de overlay APAGADAS por el canal (env MOTION_TYPES_OFF, coma-separada)."""
    raw = (os.environ.get("MOTION_TYPES_OFF") or "").strip().lower()
    if raw not in _MOTION_TYPES_OFF_CACHE:
        _MOTION_TYPES_OFF_CACHE.clear()
        _MOTION_TYPES_OFF_CACHE[raw] = {x.strip() for x in re.split(r"[,\s]+", raw) if x.strip()}
    return _MOTION_TYPES_OFF_CACHE[raw]


def _filter_type(typ: str) -> str:
    """Aplica los toggles de familias del usuario. Devuelve el tipo (quizá degradado) o '' si la
    escena debe quedarse SIN overlay porque su familia y los fallbacks están apagados."""
    off = _disabled_families()
    if not off:
        return typ
    fam = _TYPE_FAMILY.get(typ, "lower_third")
    if fam not in off:
        return typ
    # degradar: primero a rótulo, luego a panel; si ambos apagados → sin overlay
    if "lower_third" not in off:
        return "lower_third"
    if "panel" not in off:
        return "keyword_card"
    return ""


def _avatar_side(scene: dict, fallback: str) -> str:
    avatar = (scene.get("avatar") or "").strip()
    if avatar in {"side_right", "corner_br", "corner_tr"}:
        return "left"
    if avatar in {"side_left", "corner_bl", "corner_tl"}:
        return "right"
    return fallback


def _avatar_safe_type(scene: dict, typ: str) -> str:
    avatar = (scene.get("avatar") or "").strip()
    if not avatar:
        return typ
    if avatar == "fullscreen":
        return "lower_third"
    if typ in {
        "title_full", "quote", "big_word", "number_badge", "ranking_card",
        "ae_icon_burst", "ae_3d_stack", "ae_data_orbit", "ae_depth_title",
        "ae_hud_panel", "ae_object_rig", "ae_device_scene",
        "ae_workflow_blueprint", "ae_code_orchestrator",
    }:
        return "avatar_safe_panel"
    if typ == "timeline" and avatar in {"corner_br", "corner_bl"}:
        return "avatar_safe_panel"
    return typ


def _high_motion_type(typ: str, text: str, index: int) -> str:
    """Eleva el modo high a plantillas tipo motion-studio sin depender de prompts."""
    low_high = (text or "").lower()
    if re.search(r"\b(claude|codex|workflow|pipeline|editor|codigo|code|terminal|prompt|prompts|modelo|model|thinking|pensando|razona|remotion|render|export|interfaz|interface|dashboard|software|app)\b", low_high):
        return "ae_code_orchestrator"
    if typ in {
        "none", "avatar_safe_panel", "lower_third", "ae_icon_burst",
        "ae_3d_stack", "ae_data_orbit", "ae_depth_title", "ae_hud_panel",
        "ae_floating_showcase", "ae_prompt_terminal", "ae_node_map",
        "ae_product_spotlight", "ae_kinetic_badge", "ae_object_rig",
        "ae_device_scene", "ae_workflow_blueprint", "ae_code_orchestrator",
        "ae_documentary_rank", "ae_specs_plate",
        "stat_big", "chart",
        "cross_section", "cutaway", "blueprint", "depth_section",
        "tunnel_section", "schematic",
    }:
        return typ
    low = (text or "").lower()
    if re.search(r"\b(claude|codex|cloud\s*code|workflow|pipeline|editor|codigo|c[oó]digo|code|terminal|prompt|prompts|modelo|model|thinking|pensando|razona|remotion|render|export|interfaz|interface|dashboard|software|app)\b", low):
        return "ae_code_orchestrator"
    if re.search(r"\b(movil|m[oó]vil|telefono|tel[eé]fono|iphone|android|app|aplicaci[oó]n|pantalla|screen|dashboard|interfaz|interface|software|web|editor)\b", low):
        return "ae_device_scene"
    if re.search(r"\b(cohete|rocket|starship|raptor|motor|motores|avion|avi[oó]n|aircraft|maquina|m[aá]quina|vehiculo|veh[ií]culo|torre|plataforma|brazo|mechazilla|sat[eé]lite|producto|objeto|pieza|estructura)\b", low):
        return "ae_object_rig"
    if typ == "title_full":
        return "ae_depth_title" if index == 0 else "ae_floating_showcase"
    if typ == "process_flow":
        if re.search(r"\b(prompt|prompts|codigo|c[oó]digo|code|terminal|instala|instalar|hyperframes|remotion|qwen|claude)\b", low):
            return "ae_prompt_terminal"
        return "ae_node_map" if index % 2 else "ae_prompt_terminal"
    if typ == "stat_wall" or re.search(r"\b(\d{2,4}|%|dato|datos|cifra|estad[ií]stica)\b", low):
        return "ae_specs_plate" if re.search(r"\b(motor|motores|radar|velocidad|alcance|empuje|coste|costo|precio|capacidad|capacidades|spec|specs)\b", low) else ("ae_data_orbit" if index % 3 == 0 else "ae_kinetic_badge")
    if typ == "map_callout":
        return "ae_node_map"
    if typ in {"evidence_card", "before_after", "split_panel", "checklist"}:
        return "ae_floating_showcase" if index % 2 else "ae_hud_panel"
    if typ == "ranking_card":
        if re.search(r"\b(f-35|f35|f-22|f22|lightning|raptor|avion|avi[oÃ³]n|cohete|starship|top|ranking)\b", low):
            return "ae_documentary_rank"
        return "ae_product_spotlight" if re.search(r"\b(producto|productos|marca|brand|alimento|alimentos|semilla|semillas|pepita|pepitas|beneficio|beneficios|uso|usos)\b", low) else "ae_kinetic_badge"
    if typ in {"keyword_card", "big_word", "timeline", "quote"}:
        return "ae_kinetic_badge" if index % 2 else "ae_floating_showcase"
    return "ae_floating_showcase"


def _motion_worthy(text: str, scene: dict, index: int, total: int,
                   quality: str, motion_level: str = "mid") -> bool:
    """Decide si una escena merece motion graphics.

    motion_level controla la densidad:
      none  → nunca (0%)
      low   → solo intro + cierre + cada ~5 escenas
      mid   → escenas clave cada 2-3 (default)
      high  → casi todas las escenas
    """
    if motion_level == "none":
        return False
    forced = (scene.get("motion") or "").strip()
    if forced and forced != "none":
        return True
    if forced == "none" and motion_level != "high":
        return False
    # ALTO: las escenas 'none' son CANDIDATAS (la densidad la pide el usuario para el showcase);
    # el CONTENIDO real (nombre propio/lugar/cifra hablada) y el guardia de no-consecutivas del
    # bucle principal deciden cuáles llevan de verdad un overlay. Cae a la lógica por índice.
    low_text = (text or "").lower()
    # Intro y cierre siempre (excepto motion_level=none, ya filtrado)
    if index in {0, max(0, total - 1)}:
        return motion_level != "none"
    if motion_level == "low":
        # Solo keywords muy importantes cada ~5 escenas
        if re.search(r"\b(\d{2,4}|%|top|ranking|clave|secreto|descubri)\b", low_text):
            return index % 3 == 0
        return index % 5 == 0
    # mid / high — MENOS títulos y con SENTIDO (el usuario: "demasiados títulos"). Título solo en
    # escenas con un DATO FUERTE (cifra de 2-4 dígitos, %, récord, ranking, clave) y SIN ponerlos
    # en escenas consecutivas; las escenas normales llevan título solo de vez en cuando (ritmo) →
    # deja respirar al metraje. Densidad ajustable con MOTION_DENSITY_STEP.
    try:
        _step = int(os.environ.get("MOTION_DENSITY_STEP", "0") or 0)
    except ValueError:
        _step = 0
    strong = bool(re.search(
        r"\b(\d{2,4}|\d+\s*%|top|ranking|r[eé]cord|clave|secreto|dato|cifra|millones|miles|"
        r"primera vez|[uú]nico|nunca antes)\b", low_text))
    if motion_level == "high":
        # ALTO: densidad ~50% pero SIN escenas consecutivas → SOLO índices PARES (i e i+1 nunca
        # llevan overlay a la vez). Antes era cada 4ª (~25%) y el vídeo salía casi pelado (~4
        # overlays sobrevivían). El presupuesto + spacing + supresión-de-basura de
        # build_motion_events lo recortan a un ritmo equilibrado y priorizan el MIX de tipos
        # (mapa/chart/cifra/título/rótulo). MOTION_DENSITY_STEP lo sigue afinando.
        return index % (_step or 2) == 0
    if strong:
        return index % 2 == 0            # dato fuerte → título, pero 1 de cada 2 (no consecutivos)
    base = _step or (4 if quality == "high" else 5)
    return index % base == 0             # escena normal → título esporádico (ritmo)


# ── Labels por idioma ─────────────────────────────────────────────────────────

_KICKER_LABELS: dict[str, dict[str, str]] = {
    "es": {
        "title_full": "Título", "keyword_card": "Punto clave", "process_flow": "Flujo",
        "checklist": "Verificación", "split_panel": "Comparación", "timeline": "Cronología",
        "big_word": "Concepto", "ranking_card": "Ranking", "evidence_card": "Evidencia",
        "map_callout": "Ubicación", "before_after": "Antes / Después", "stat_wall": "Dato clave",
        "avatar_safe_panel": "Detalle", "lower_third": "Referencia", "quote": "Cita",
        "scene": "Escena",
        "ae_object_rig": "Objeto 3D", "ae_device_scene": "Interfaz",
        "ae_workflow_blueprint": "Sistema",
        "ae_code_orchestrator": "Orquestador",
        "ae_documentary_rank": "Ranking", "ae_specs_plate": "Ficha tecnica",
    },
    "en": {
        "title_full": "Title", "keyword_card": "Key Point", "process_flow": "Flow",
        "checklist": "Checklist", "split_panel": "Comparison", "timeline": "Timeline",
        "big_word": "Concept", "ranking_card": "Ranking", "evidence_card": "Evidence",
        "map_callout": "Location", "before_after": "Before / After", "stat_wall": "Key Fact",
        "avatar_safe_panel": "Detail", "lower_third": "Reference", "quote": "Quote",
        "scene": "Scene",
        "ae_object_rig": "3D Object", "ae_device_scene": "Interface",
        "ae_workflow_blueprint": "System",
        "ae_code_orchestrator": "Orchestrator",
        "ae_documentary_rank": "Rank", "ae_specs_plate": "Specs",
    },
}


def _kicker_label(typ: str, lang: str = "es") -> str:
    labels = _KICKER_LABELS.get(lang, _KICKER_LABELS.get("en", {}))
    return labels.get(typ, typ.replace("_", " ").title())


def _premium_motion_requested(hint: str) -> bool:
    # OJO: "after effects" / "premium" / "cinematic" / "motion graphics" significan
    # CALIDAD y PULIDO para el usuario (que parezca REAL y profesional), NO "mete
    # plantillas 3D / UI de software falsas". Esos tipos ae_* tapan el metraje real y
    # parecen un promo de SaaS → rompen el documental. Solo se activan si el usuario
    # pide EXPLÍCITAMENTE elementos técnicos 3D (hud, 3d, holograma, blueprint…).
    return bool(re.search(
        r"\b(hud|3d|holograma|hologram|nodo|nodos|node\s*map|terminal|blueprint|"
        r"mockup|wireframe|render\s*3d)\b",
        (hint or "").lower(),
    ))


def _object_hint(scene: dict, text: str, title: str) -> str:
    objects = scene.get("motion_objects") or []
    if isinstance(objects, list):
        clean = [str(x).strip() for x in objects if str(x).strip()]
        if clean:
            return clean[0][:44]
    design = _plain(scene.get("motion_design") or scene.get("motion_purpose") or "")
    haystack = f"{text} {design}".lower()
    for pattern, label in [
        (r"\b(starship|cohete|rocket|raptor|super heavy)\b", "Starship"),
        (r"\b(movil|m[oó]vil|telefono|tel[eé]fono|iphone|app|pantalla|screen)\b", "mobile screen"),
        (r"\b(avion|avi[oó]n|aircraft|jet)\b", "aircraft"),
        (r"\b(motor|engine|motores)\b", "engine"),
        (r"\b(torre|plataforma|mechazilla|brazo)\b", "launch tower"),
        (r"\b(documento|informe|archivo|licencia|faa)\b", "document stack"),
    ]:
        if re.search(pattern, haystack):
            return label
    return title[:44] or "object"


def build_motion_events(scenes: list[dict], duration: float, quality: str = "low",
                        motion_level: str = "mid", lang: str = "es",
                        motion_style_hint: str = "") -> list[dict]:
    """Genera overlays desde escenas/SRT sin IA.

    motion_level: none | low | mid | high — controla cuántos overlays se generan.
    lang: idioma para los labels de los overlays.
    """
    events: list[dict] = []
    quality = (quality or "low").lower()
    motion_level = (motion_level or "mid").lower()
    if motion_level not in {"none", "low", "mid", "high"}:
        motion_level = "mid"
    if motion_level == "none":
        return []
    # Paleta de acento = la del TEMA del canal (ch.remotionTheme → PIPELINE_MOTION_THEME).
    # ⚠ BUG 2026-07-17: aquí se forzaba "#D4A76A" (dorado) en TODOS los eventos y en video.tsx
    # gana `event.accent || th.accent` → el dorado PISABA el color del tema y NINGÚN canal podía
    # cambiarlo (crime seguía dorado en vez de rojo, militar en vez de amarillo…). La tipografía
    # sí cambiaba (Anton/Playfair), solo el color estaba capado. Se espeja aquí la paleta de
    # THEMES (video.tsx) para que Python y el render coincidan (mapas/banderas incluidos).
    # MOTION_ACCENT sigue mandando por encima → color de marca por canal.
    _THEME_ACCENTS = {
        "documentary": "#c9a86a", "history": "#caa15a", "crime": "#e23b3b",
        # TRUE CRIME + sus ALIAS (THEME_ALIAS en video.tsx): el canal puede llamarlo 'narco' o
        # 'crimen' y el tema se resuelve allí, pero el acento se decide AQUÍ y gana
        # (event.accent || th.accent) → sin espejar los alias, un canal 'narco' salía DORADO.
        "truecrime": "#e23b3b", "true-crime": "#e23b3b", "narco": "#e23b3b",
        "crimen": "#e23b3b",
        "geography": "#37b6c7", "modern": "#D4A76A", "minimal": "#ffffff",
        "standard": "#D4A76A", "military": "#ffe000", "nature": "#5cbf73",
        "science": "#4aa8ff", "business": "#c9a86a",
        # TEMAS AÑADIDOS (2026-07-17, "ponle varias tipografías tú también"): ver THEMES en
        # video.tsx. Cada uno con su emparejamiento tipográfico propio.
        "editorial": "#b23a2e", "impact": "#ff5a1f", "newsroom": "#2f7de1", "sport": "#26d07c",
        "constructum": "#F2A51A", "vidrush": "#F2A51A", "construccion": "#F2A51A", "construcción": "#F2A51A",
    }
    # ESPEJO de THEME_ALIAS (video.tsx): el canal puede escribir 'militar', 'narco' o 'revista' y
    # el TS resuelve el TEMA (tipografía/panel), pero el ACENTO se decide AQUÍ y gana en el render
    # (`event.accent || th.accent`). Sin espejar los alias, un canal 'militar' salía DORADO en vez
    # de amarillo (mismo bug que ya mordió con 'narco'). Se resuelve el alias antes de buscar color.
    _THEME_ALIAS = {
        "terror": "crime", "true-crime": "truecrime", "narco": "truecrime", "crimen": "truecrime",
        "historia": "history", "geografia": "geography", "geografía": "geography",
        "documental": "documentary", "moderno": "modern", "minimalista": "minimal",
        "estandar": "standard", "estándar": "standard",
        "militar": "military", "guerra": "military", "belico": "military", "bélico": "military",
        "war": "military", "naturaleza": "nature", "natura": "nature", "wildlife": "nature",
        "animales": "nature", "ciencia": "science", "espacio": "science", "space": "science",
        "cosmos": "science", "tecnologia": "science", "negocios": "business",
        "finanzas": "business", "economia": "business", "economía": "business",
        "dinero": "business",
        "revista": "editorial", "magazine": "editorial", "prensa": "editorial",
        "ensayo": "editorial", "articulo": "editorial", "artículo": "editorial",
        "reportaje": "editorial",
        "impacto": "impact", "bold": "impact", "viral": "impact", "shock": "impact",
        "noticias": "newsroom", "news": "newsroom", "informativo": "newsroom",
        "periodismo": "newsroom", "actualidad": "newsroom", "redaccion": "newsroom",
        "redacción": "newsroom",
        "sports": "sport", "deporte": "sport", "deportes": "sport", "futbol": "sport",
        "fútbol": "sport", "fitness": "sport", "gym": "sport",
        "vidrush": "constructum", "constructum": "constructum", "construccion": "constructum", "construcción": "constructum",
    }
    _theme_now = (os.environ.get("PIPELINE_MOTION_THEME") or "documentary").strip().lower()
    _theme_now = _THEME_ALIAS.get(_theme_now, _theme_now)
    _accent = ((os.environ.get("MOTION_ACCENT") or "").strip()
               or _THEME_ACCENTS.get(_theme_now, "#D4A76A"))
    # SIEMPRE el mismo dorado (antes alternaba blanco/amarillo → texto invisible sobre
    # fondos claros y marca incoherente). Un solo acento = look VidRush consistente.
    colors = [_accent]
    # Temáticas de CONFLICTO (crime/militar/guerra/historia): el mapa vectorial muestra el
    # war-room (cazas + impacto) en las rutas; el resto de temas usa una FLECHA limpia genérica
    # (una ruta con explosión en un vídeo de negocios/naturaleza quedaba fuera de tono).
    _conflict_theme = (os.environ.get("PIPELINE_MOTION_THEME") or "documentary").strip().lower() in {
        "crime", "terror", "truecrime", "true-crime", "military", "militar", "war", "guerra",
        "belico", "bélico", "history", "historia"}
    total = max(1, len(scenes))
    # Overlays de texto SOBRE metraje real por defecto (estilo documental/VidRush):
    # nada de escenas 3D/UI opacas que tapen el b-roll. Es lo que quieren TODOS los
    # canales del usuario (real + titulares). Desactivable con
    # PIPELINE_MOTION_OVERLAY_ONLY=0 para quien quiera plantillas 3D explícitas.
    _documentary = os.environ.get("PIPELINE_DOCUMENTARY", "0").strip().lower() in {
        "1", "true", "yes", "on",
    }
    # 🎬 HQ IA MIX (2026-09-23): misma gramática que el documental — el 'none' del planner es
    # 'none', overlays sobre la imagen (docStyle: cifra centrada limpia, sin paneles) y la
    # pirámide solo si el especialista la pidió.
    _hq_mix = os.environ.get("PIPELINE_HQ_MIX", "0").strip().lower() in {"1", "true", "yes", "on"}
    _documentary = _documentary or _hq_mix
    _overlay_only = _documentary or os.environ.get(
        "PIPELINE_MOTION_OVERLAY_ONLY", "1").strip().lower() in {"1", "true", "yes", "on"}
    premium_hint = _premium_motion_requested(motion_style_hint) and not _overlay_only
    # 🎬 ESTILO VOX: señal EN BANDA (el hint viaja en job/manifest → el editor y
    # Remotion Studio reconstruyen los mismos eventos que el pipeline, aunque el
    # env del proceso no lo tenga o venga heredado de otro job). El env queda solo
    # como respaldo para runs manuales por CLI.
    _vox_on = ("ESTILO VOX ACTIVO" in (motion_style_hint or "")
               or os.environ.get("PIPELINE_MOTION_STYLE", "").strip().lower() == "vox")

    # ── MAPA por UBICACIÓN (determinista, 2026-07-15) ──────────────────────────────
    # GLM casi NUNCA marca las ubicaciones (Putin: 236 escenas, 0 motion_loc → ni un mapa pese
    # a nombrar Ártico/Ucrania/Rusia). Aquí se ESCANEA el texto por nombres de lugar y, en la
    # PRIMERA mención de un lugar nuevo (con HUECO entre mapas para que sea de vez en cuando),
    # se fuerza map_zoom con motion_loc/motion_country → el sistema geocodifica y traza el país.
    # NO pisa motions con sentido (solo escenas 'none'/vacías). GLM sigue pudiendo pedir mapas;
    # esto es la RED de seguridad para que SÍ aparezcan cuando el guion nombra sitios.
    _deacc = str.maketrans("áàäâãéèëêíìïîóòöôõúùüûñç", "aaaaaeeeeiiiiooooouuuunc")
    _map_max = int(os.environ.get("MAP_MAX", "6") or 6)
    _map_gap = int(os.environ.get("MAP_MIN_GAP_SCENES", "12") or 12)
    _MAP_MOTIONS = {"map_zoom", "cloud_map", "map_descend", "map_route", "map_callout", "map"}

    def _scan_place(scene: dict):
        # El texto de la escena vive en query (EN, el visual) y a veces en text/motion_title
        # → escaneamos los tres (los guiones ES nombran el lugar y el query EN lo refleja).
        _tx = (str(scene.get("text") or "") + " " + str(scene.get("query") or "")
               + " " + str(scene.get("motion_title") or "")).lower().translate(_deacc)
        for _key, (_lab, _cty) in _GEO_GAZETTEER:
            if re.search(r"\b" + re.escape(_key) + r"\b", _tx):
                return _lab, _cty
        return None, None

    if _map_max > 0 and (motion_level in {"mid", "high"} or _hq_mix) and not _vox_on:
        _mapped: set = set()
        _n_maps = 0
        _last_map_i = -10 ** 6
        # ── PASE A — RESCATE de los mapas que el planner YA pidió pero SIN país resoluble.
        # Se rellena motion_country/motion_loc desde el gazetteer sobre la escena de la MENCIÓN
        # real (con su duración) → así el mapa NO se lo roba una escena-intro de 2s cuyo query
        # nombra el lugar de pasada, y la escena real deja de degradarse a rótulo (bug: la 'fuga'
        # del Altiplano salía sin mapa). Reserva el lugar para que el pase B no lo duplique.
        for i, scene in enumerate(scenes or []):
            if (scene.get("motion") or "").strip().lower() not in _MAP_MOTIONS:
                continue
            _n_maps += 1
            _last_map_i = i
            if (scene.get("motion_country") or scene.get("country") or "").strip():
                _lab0 = (scene.get("motion_loc") or scene.get("location") or "").strip()
                if _lab0:
                    _mapped.add(_lab0.lower())
                continue
            _lab, _cty = _scan_place(scene)
            if _lab:
                if not (scene.get("motion_loc") or scene.get("location") or "").strip():
                    scene["motion_loc"] = _lab
                if _cty:
                    scene["motion_country"] = _cty
                _mapped.add(_lab.lower())
        # ── PASE B — RED DE SEGURIDAD: escenas 'none' que nombran un lugar NUEVO (con hueco entre
        # mapas) → se fuerza map_zoom. GLM casi nunca marca ubicaciones (Putin: 236 escenas, 0
        # motion_loc); esto garantiza que aparezcan cuando el guion nombra sitios. No pisa motions
        # con sentido (solo 'none'/vacías) ni repite un lugar ya mapeado en el pase A.
        for i, scene in enumerate(scenes or []):
            if _n_maps >= _map_max:
                break
            if (scene.get("motion") or "").strip() not in ("", "none"):
                continue
            if i - _last_map_i < _map_gap:
                continue
            _lab, _cty = _scan_place(scene)
            if _lab and _lab.lower() not in _mapped:
                scene["motion"] = "map_zoom"
                scene["motion_loc"] = _lab
                if _cty:
                    scene["motion_country"] = _cty
                _mapped.add(_lab.lower())
                _n_maps += 1
                _last_map_i = i

    # ── ESQUEMA EN CORTE (cutaway) por VENTANA de escenas (2026-07-17) ────────────────────────
    # Ver _cutaway_window: las escenas son FRAGMENTOS de frase, así que el esquema NO se puede
    # decidir escena a escena (ninguna trae la estructura Y sus partes). Se mira una VENTANA de
    # 2-5 escenas seguidas y sale UN cross_section que la cubre; los overlays menores de dentro se
    # SUPRIMEN — incluida la cifra forzada del planner para la longitud del túnel: la cota la
    # dibuja el propio esquema, así que lo subsume ("nunca dos overlays a la vez"). En MEDIO y ALTO
    # (el usuario, 2026-07-17: "aplicar al flujo que lo pueda hacer en MEDIO y ALTO. En BAJO esto no
    # hace falta"), y sin estilo Vox (que tiene su propio repertorio). Ojo: esto NO sube la densidad
    # en medio — el esquema SUSTITUYE a los overlays menores de su ventana, y solo sale si el guion
    # describe de verdad una estructura Y sus partes. Sin ventana válida NO cambia nada.
    _cut_range: set = set()
    _cut = (_cutaway_window(scenes or [], lang)
            if (motion_level in {"mid", "high"} and not _vox_on and not _hq_mix) else None)
    if _cut:
        _c0, _c1 = _cut["i0"], _cut["i1"]
        _cut_start = float(scenes[_c0].get("start", 0) or 0)
        _cut_end = (float(scenes[_c1].get("start", 0) or 0)
                    + max(0.0, float(scenes[_c1].get("duration", 0) or 0)))
        # tope: la próxima escena con motion del planner (no le robamos su ventana) y el vídeo.
        for _j in range(_c1 + 1, len(scenes or [])):
            if (scenes[_j].get("motion") or "").strip().lower() not in ("", "none"):
                _cut_end = min(_cut_end, float(scenes[_j].get("start", duration) or duration))
                break
        try:
            _cut_max = max(4.0, float(os.environ.get("CUTAWAY_MAX_SECONDS", "14") or 14))
        except (TypeError, ValueError):
            _cut_max = 14.0
        _cut_end = min(_cut_end, duration, _cut_start + _cut_max)
        if _cut_end - _cut_start >= 2.5:      # sin tiempo real de lectura no merece la pena
            events.append({
                "id": f"s{_c0}_cutaway",
                "type": "cross_section",
                "kicker": "",
                "start": round(max(0.0, _cut_start), 3),
                "duration": round(_cut_end - _cut_start, 3),
                "title": _cut["title"][:72],
                # las MEDIDAS van en el subtítulo: CrossSection (_grab) rotula las cotas desde ahí.
                "subtitle": _cut["subtitle"][:135],
                "items": _cut["items"],
                "design": "",
                "objectHint": _cut["title"][:44],
                "rank": 0,
                "side": "left",
                "accent": _accent,
                "theme": (os.environ.get("PIPELINE_MOTION_THEME") or "documentary").strip().lower(),
                "font": (os.environ.get("PIPELINE_MOTION_FONT") or "").strip(),
            })
            _cut_range = set(range(_c0, _c1 + 1))
            print(f"[remotion] Esquema en corte: escenas {_c0}-{_c1} "
                  f"({_cut_start:.1f}s-{_cut_end:.1f}s), partes={_cut['items']}", flush=True)

    # ── GRÁFICA DE BARRAS por VENTANA de escenas (2026-07-17) ─────────────────────────────────
    # El usuario: "quiero que también haya algún esquema… alguna gráfica, algo que se vea" y
    # "en caso que no [se pueda], lo dejamos así". Ver _chart_window: solo sale si la narración
    # trae ≥2 cantidades REALES comparables (misma unidad/magnitud); sin datos NO se emite nada.
    # Mismo patrón que el esquema en corte: una pieza grande que SUBSUME los overlays de su
    # ventana → nunca dos overlays a la vez.
    _chart_range: set = set()
    _cha = _chart_window(scenes or [], lang) if (motion_level in {"mid", "high"} and not _vox_on) else None
    if _cha and not (set(range(_cha["i0"], _cha["i1"] + 1)) & _cut_range):
        _h0, _h1 = _cha["i0"], _cha["i1"]
        _ch_start = float(scenes[_h0].get("start", 0) or 0)
        _ch_end = (float(scenes[_h1].get("start", 0) or 0)
                   + max(0.0, float(scenes[_h1].get("duration", 0) or 0)))
        # tope: la próxima escena con motion del planner (no le robamos su ventana) y el vídeo.
        for _j in range(_h1 + 1, len(scenes or [])):
            if (scenes[_j].get("motion") or "").strip().lower() not in ("", "none"):
                _ch_end = min(_ch_end, float(scenes[_j].get("start", duration) or duration))
                break
        try:
            _ch_max = max(4.0, float(os.environ.get("CHART_MAX_SECONDS", "12") or 12))
        except (TypeError, ValueError):
            _ch_max = 12.0
        _ch_end = min(_ch_end, duration, _ch_start + _ch_max)
        if _ch_end - _ch_start >= 2.5:      # sin tiempo real de lectura no merece la pena
            events.append({
                "id": f"s{_h0}_chart",
                "type": "chart",
                # FORMA de la gráfica (2026-07-18): 'line' = serie de AÑOS → línea de tendencia
                # que se dibuja (el look del demo Vox "INFLACIÓN ANUAL", pero como OVERLAY sobre
                # el metraje y con la tipografía/acento del TEMA, no en tarjeta de papel).
                # 'bars' = comparación entre categorías → la gráfica de barras de siempre.
                # El tipo sigue siendo "chart": duración, prioridad, protección de la cifra y el
                # mapeo a vox_chart NO cambian. video.tsx obedece y, si no llegan ≥3 puntos
                # reales, cae solo a barras → nunca una línea con datos inventados.
                "chartKind": _cha.get("kind") or "bars",
                "kicker": "",
                "start": round(max(0.0, _ch_start), 3),
                "duration": round(_ch_end - _ch_start, 3),
                "title": _cha["title"][:72],
                "subtitle": _cha["subtitle"][:135],
                "items": _cha["items"],
                "design": "",
                "objectHint": "",
                "rank": 0,
                "side": "left",
                "accent": _accent,
                "theme": (os.environ.get("PIPELINE_MOTION_THEME") or "documentary").strip().lower(),
                "font": (os.environ.get("PIPELINE_MOTION_FONT") or "").strip(),
            })
            _chart_range = set(range(_h0, _h1 + 1))
            print(f"[remotion] Gráfica de "
                  f"{'LÍNEA (serie temporal)' if _cha.get('kind') == 'line' else 'barras'}: "
                  f"escenas {_h0}-{_h1} "
                  f"({_ch_start:.1f}s-{_ch_end:.1f}s), datos={_cha['items']}", flush=True)

    # Escenas del planner con motion propio (≠none): el usuario ELIGIÓ ponerles overlay. Sirven
    # de referencia para NO añadir overlays en escenas 'none' pegadas a ellas del MISMO tipo.
    _planner_idx = {i for i, s in enumerate(scenes or [])
                    if (s.get("motion") or "").strip() not in ("", "none")}
    _added_idx: set = set()   # escenas 'none' a las que ESTE pase les añade un overlay
    for i, scene in enumerate(scenes or []):
        # El ESQUEMA en corte / la GRÁFICA ya cubren estas escenas: ningún overlay menor dentro de
        # su ventana (tampoco la cifra forzada del planner — la pinta la propia pieza).
        if i in _cut_range or i in _chart_range:
            continue
        start = float(scene.get("start", 0) or 0)
        dur = max(1.2, float(scene.get("duration", 4) or 4))
        end = min(duration, start + dur)
        text = _plain(scene.get("text") or scene.get("query") or "")
        _is_none_scene = (scene.get("motion") or "").strip() in ("", "none")
        # 'none' ya NO es veto absoluto en ALTO (densidad para el showcase); en el resto de niveles
        # se mantiene el veto de siempre. Sin contenido real, la supresión de basura de más abajo
        # deja la escena limpia igualmente.
        if scene.get("motion") == "none" and motion_level != "high":
            continue
        # NUNCA en escenas consecutivas: no AÑADIR overlay en una 'none' si una vecina (i±1) YA
        # lleva otro overlay AÑADIDO en este pase (las del planner ya vienen espaciadas). Así se
        # respeta "nunca dos overlays en escenas seguidas" del propio pipeline.
        if _is_none_scene and motion_level == "high" and ((i - 1) in _added_idx or (i + 1) in _added_idx):
            continue
        # PIRÁMIDE/JERARQUÍA con contenido FUERTE (planner la pidió, o 3-5 niveles reales +
        # palabras de rango): pieza grande que SIEMPRE merece render (como un mapa) — no la corta
        # la cadencia por índice de _motion_worthy. Genérico; sin lista de niveles no se fabrica.
        _wants_pyramid = ((scene.get("motion") or "").strip().lower() in _PYRAMID_TYPES
                          or _looks_hierarchical(scene, text))
        if not _wants_pyramid and not _motion_worthy(text, scene, i, total, quality, motion_level):
            continue
        # Escena-TARJETA: SIN rótulos de ESQUINA encima (texto nunca sobre fondo de color) —
        # pero las piezas GRANDES sí pasan: el MAPA/CHART son pantalla completa (tapan la
        # tarjeta) y la CIFRA stat_big cae centrada sobre la foto con su scrim. Antes se
        # suprimía TODO el motion de la escena → en Normandía desaparecieron el mapa y el
        # 20.000 (bug real). Solo se filtran los overlays pequeños.
        _card_ok = {"map_zoom", "cloud_map", "map_descend", "map_route", "site_plan", "chart",
                    "stat_big", "big_stat", "big_date", "hero_stat", "section_title", "title_full",
                    "engineering_schematic", "structure_compare", "process_flow", "timeline", "pyramid",
                    "vox_scene", *_VIDRUSH_MOTIONS}
        if scene.get("_carded") and (scene.get("motion") or "").strip() not in _card_ok:
            continue
        raw_title = _plain(scene.get("motion_title") or scene.get("title") or "")
        if _looks_wrong_language_title(raw_title, lang):
            raw_title = ""
        # Rótulo = motion_title CURADO del planner; si no hay, SOLO una cifra; si no,
        # vacío → se suprime abajo (metraje limpio). Ya NO se fabrica de las 4 primeras
        # palabras del SRT (salía 'Estén meditando a Valencia'). Fix 2026-07-13.
        title = raw_title or _num_title(text)
        # ALTO + escena 'none' SIN etiqueta curada: intenta un NOMBRE PROPIO/LUGAR real de la
        # narración (_proper_noun_label exige ≥2 tokens capitalizados → nunca un fragmento de
        # frase). Si no hay ninguno, title queda '' y la supresión de basura deja el metraje limpio.
        _proper_label = False
        if not title and _is_none_scene and motion_level == "high":
            title = _proper_noun_label(text)
            _proper_label = bool(title)
        # El motion literal 'none'/'' NO es texto de escena → para tipar una escena 'none' se pasa
        # su NARRACIÓN (así una 'none' con cifra→stat_wall, con lugar→map_callout, etc.).
        _motion_hint = (scene.get("motion") or "").strip()
        if _motion_hint.lower() in ("", "none"):
            _motion_hint = ""
        # DOCUMENTAL (2026-09-05): el 'none' del planner ES 'none'. Antes la escena se tipaba
        # por heurística de texto (lugar→map_callout, nombre propio→lower_third, dígito→
        # stat_wall) y salían mapas y rótulos que nadie había pedido (el mapa de México sin
        # hablar de localización, un rótulo cada dos escenas). DOC_RESPECT_NONE=0 lo desactiva.
        if (_documentary and str(scene.get("motion") or "").strip().lower() == "none"
                and os.environ.get("DOC_RESPECT_NONE", "1").strip().lower() in {"1", "true", "yes", "on"}):
            continue
        typ = _event_type(_motion_hint or text, i, total)
        # Solo subir a los tipos 3D "ae_*" si el usuario los pide explícitamente
        # (motion_style_hint con AE/3D/premium). Por defecto, incluso en ALTO, se usan
        # los tipos LIMPIOS estilo VidRush (lower_third, big_word, keyword_card,
        # stat_wall, ranking real) → más legibles y menos "saturados/genéricos".
        if premium_hint and motion_level == "high":
            typ = _high_motion_type(typ, text, i)
        typ = _avatar_safe_type(scene, typ)
        # Sin premium → tipos LIMPIOS (mapea ae_* 3D saturados a su equivalente VidRush).
        if not premium_hint:
            typ = _CLEAN_TYPE_MAP.get(typ, typ)
        # Si salió tipo RANKING pero no hay un número de ranking REAL en el texto,
        # bajar a un tipo limpio (evita el "#15" inventado en escenas normales).
        real_rank = _rank_from_text(text, i)
        if typ in {"ranking_card", "ae_documentary_rank"} and real_rank <= 0:
            typ = "stat_wall" if re.search(r"\d", text) else "keyword_card"
        # Clamp final: si es overlay-only (por defecto), mapea tipos opacos ae_* a un
        # overlay que deja ver el b-roll real (nunca una escena 3D/UI que lo tape).
        if _overlay_only:
            typ = _doc_overlay_clamp(typ, text, real_rank)
        # Etiqueta de NOMBRE PROPIO en escena 'none' = rótulo limpio (lower_third), no un
        # keyword_card (que podría arrastrar bullets fabricados del texto). Solo si el tipo salió
        # genérico de texto; un mapa/stat detectado por el propio contenido se respeta.
        if _proper_label and typ in {"keyword_card", "big_word", "timeline", "quote"}:
            typ = "lower_third"
        accent = colors[i % len(colors)]
        side = _avatar_side(scene, "right" if i % 3 == 1 else "left")
        items = _motion_items(scene, text, ["Guion", "Voz", "SRT", "Assets", "Montaje"])
        # Una "cifra" SIN dígitos es un título disfrazado (p.ej. "Decenas de millones"):
        # BigStat la trunca ("Decenas de millon…"), su piso de duración la alarga sobre la
        # escena siguiente y la protección anti-solape mata el overlay vecino (visto en
        # render real). Se degrada a lower_third, que es lo que corresponde visualmente.
        # stat_wall NO se toca: video.tsx ya lo resuelve solo (número→Stat, ≥2 bullets→
        # SpecPanel, resto→LowerThird) y degradarlo aquí perdía el panel de specs.
        # stat_big without a real number degrades to lower_third in ALL flows
        # (including documentary). "El telar" / "TRUEQUE" centered on screen looks
        # wrong — stat_big is for numeric data only.
        if typ in {"stat_big", "big_stat", "hero_stat", "number_badge"} \
                and not _has_number(title):
            typ = "lower_third"

        # PIRÁMIDE / JERARQUÍA: si el planner la pidió (motion/tipo en esos nombres) O, de forma
        # GENÉRICA, la escena trae 3-5 items que se leen como niveles/rangos (líder→base, "nivel/
        # tier/rango"). NO se fabrica jerarquía sin lista de niveles. video.tsx cae a SpecPanel/
        # LowerThird si al final hay <2 niveles reales.
        # ⚠ En DOCUMENTAL el tipo lo decide el planner editorial: esta heurística convertía un
        # callout "PIRÁMIDE DE CHOLULA" con 3 items en un diagrama de jerarquía (banco v4).
        if (not _documentary
                and (str(scene.get("motion") or "").strip().lower() in _PYRAMID_TYPES
                     or typ in _PYRAMID_TYPES
                     or _looks_hierarchical(scene, text))):
            typ = "pyramid"

        # TÍTULO DE SECCIÓN en los "saltos de capítulo" (solo ALTO): si el planner dio un título
        # CURADO (raw_title real, no basura del SRT) en la BANDA de ~1/3 o ~2/3 del vídeo — o es la
        # ÚLTIMA escena (tarjeta de cierre) — y el tipo sería un rótulo genérico, se muestra como
        # section_title → jerarquía real y un MIX más rico (el usuario quiere ver el repertorio, no
        # solo lower-thirds). NO fabrica texto: sin raw_title del planner no promociona nada.
        _cband = max(1, total // 9)
        _at_chapter = (abs(i - total // 3) <= _cband or abs(i - (2 * total) // 3) <= _cband
                       or i == total - 1)
        if (motion_level == "high" and raw_title
                and typ in {"lower_third", "keyword_card", "big_word"}
                and total >= 6 and _at_chapter):
            typ = "section_title"

        # 🎛 TOGGLES DE TIPOS del canal (MOTION_TYPES_OFF): si la familia de este overlay está
        # apagada por el usuario, se degrada a rótulo/panel o se OMITE la escena (sin overlay).
        # Va tras decidir el tipo LIMPIO y ANTES de la re-piel Vox, para filtrar por familia real.
        typ = _filter_type(typ)
        if not typ:
            continue

        # Vidrush mechanisms need a real reading window. Never stretch a short SRT segment
        # past its cut (that would desynchronize the next asset); demote it to a simple
        # lower-third instead. For valid windows, keep the whole SRT interval so the motion
        # and the narrated visual end on the same cut rather than at high-quality's old 0.9x
        # cap (which produced 3.78s events and failed the strict 3.8s QC).
        if typ in (_VIDRUSH_MOTIONS | _SCHEMATIC_MOTIONS) and dur < 3.8:
            typ = "lower_third"

        # 🎬 ESTILO VOX (opt-in del canal): los momentos clave se convierten en
        # ESCENAS de papel estilo After Effects/Vox: stat_big→vox_counter (el
        # anclaje a la voz de abajo aplica igual porque vox_counter está en
        # _num_type) · chart→vox_chart · section_title→vox_paper. El motion=
        # vox_scene EXPLÍCITO del planner también se respeta aquí (_event_type
        # no lo conoce y lo degradaba a heurísticas → la escena de recortes
        # halftone era código muerto). El resto (lower_third, mapas…) se queda
        # igual → ritmo híbrido metraje+Vox.
        if _vox_on:
            # el motion explícito va PRIMERO: _event_type no conoce vox_scene y lo
            # degrada (p.ej. a title_full en el índice 0) → aquí ya llegaría mapeado
            # a vox_paper si se comprobara al final del elif.
            if (str(scene.get("motion") or "").strip().lower() == "vox_scene"
                    and typ != "avatar_safe_panel"):
                typ = "vox_scene"
            elif typ in {"stat_big", "big_stat", "hero_stat"}:
                typ = "vox_counter"
            elif typ in {"chart", "bar_chart", "graph"}:
                typ = "vox_chart"
            elif typ in {"section_title", "title_full"}:
                typ = "vox_paper"
        main_duration = max(3.2, min(dur * (0.9 if quality == "high" else 0.84), 8.5 if quality == "high" else 7.6))
        # stat_big (cifra con count-up) y chart (barras) necesitan AGUANTAR más tras la
        # animación (el usuario: "la cifra desaparece justo tras contar"). Piso mayor + se
        # permiten extender un poco más allá de la escena corta (hasta ~4.6s).
        _big_motion = typ in {"stat_big", "chart", "vox_counter", "vox_chart"}
        # Las composiciones Vidrush no son un rótulo instantáneo: necesitan tiempo
        # para montar evidencia, recorrer una lente o revelar una identidad. Por defecto
        # duran 4.2 s: es suficiente para leerlas y evita que una pieza editorial se quede
        # pegada hasta el final de una ventana (el problema que se detectó cerca del segundo
        # 48). El planner puede pedir otra duración mediante motion_duration, siempre dentro
        # de la ventana SRT.
        _dur_floor = 3.8 if typ in (_VIDRUSH_MOTIONS | _SCHEMATIC_MOTIONS) else (3.6 if _big_motion else 2.8)
        _dur_cap = max(main_duration, 4.6) if _big_motion else main_duration
        if typ in (_VIDRUSH_MOTIONS | _SCHEMATIC_MOTIONS):
            try:
                _vidrush_requested = float(scene.get("motion_duration") or 4.2)
            except (TypeError, ValueError):
                _vidrush_requested = 4.2
            _vidrush_requested = max(_dur_floor, min(_vidrush_requested, end - start))
            _dur_cap = _vidrush_requested
        # PANTALLA COMPLETA (mapa y escenas VOX): deben cubrir la escena ENTERA — si
        # se recortan antes del corte, el papel/mapa desaparece a metraje de golpe.
        if typ in {"map_zoom", "cloud_map", "map_descend", "map_route",
                   "vox_scene", "vox_paper", "vox_chart", "vox_counter"}:
            _dur_cap = max(_dur_cap, end - start)

        # ── MAPA: duración MÍNIMA ~5s para que se aprecie el zoom de la cámara (mundo→país,
        # ease-out sobre dur*0.5). Muchas escenas de mapa son cortas (2-3s) y el zoom no llegaba a
        # leerse. Se EXTIENDE sobre las escenas 'none' siguientes (sin overlay propio) SIN exceder
        # el tiempo disponible: se para antes del inicio de la próxima escena con motion del planner.
        # Configurable con MAP_MIN_SECONDS. El clamp anti-solape de más abajo recorta si hiciera falta.
        _MAP_FULL = {"map_zoom", "cloud_map", "map_descend", "map_route", "map_callout", "map"}
        if typ in _MAP_FULL:
            try:
                _map_min = float(os.environ.get("MAP_MIN_SECONDS", "5.0") or 5.0)
            except (TypeError, ValueError):
                _map_min = 5.0
            _map_min = max(2.0, min(_map_min, 12.0))
            _avail_end = duration
            for _j in range(i + 1, len(scenes or [])):
                _mj = (scenes[_j].get("motion") or "").strip().lower()
                if _mj and _mj != "none":
                    _avail_end = float(scenes[_j].get("start", duration) or duration)
                    break
            _map_avail = max(0.0, _avail_end - start)
            # objetivo = al menos _map_min (y al menos la propia escena), sin pasarse del disponible
            _map_target = min(max(_map_min, dur), _map_avail) if _map_avail > 0 else max(_map_min, dur)
            # En documental estricto el mapa no puede invadir la siguiente ventana SRT.
            # La extensión sobre escenas ``none`` es válida para previews, pero provoca
            # rechazo de QC cuando la escena actual dura menos que el mínimo del mapa.
            _strict_doc = (_documentary and os.environ.get("DOC_STRICT_QC", "1").strip().lower()
                           not in {"0", "false", "no", "off"})
            if _strict_doc:
                _map_target = min(_map_target, dur)
            end = min(duration, start + _map_target)
            _dur_floor = _map_target
            _dur_cap = _map_target

        # Arranque del evento. Por defecto: corte + 0.15 (títulos completos sin retardo).
        # Los MAPAS arrancan en el corte exacto (offset 0) para aprovechar toda la ventana del zoom.
        ev_start = start + (0.0 if typ in {"title_full", "ae_depth_title", *_VIDRUSH_MOTIONS, *_SCHEMATIC_MOTIONS} or typ in _MAP_FULL else 0.15)
        # CUADRAR la cifra con la HABLADA: para CUALQUIER gráfico con número (cuente o no:
        # stat_big/chart hacen count-up; stat_wall/big_word/number_badge la muestran estática),
        # localizamos DÓNDE se dice el número en la frase (en PALABRAS o dígitos) y arrancamos
        # el evento para que la cifra aparezca/aterrice JUSTO cuando la voz la dice. Antes
        # arrancaba en el corte → la cifra salía demasiado pronto y "no cuadraba".
        _num_type = typ in {"stat_big", "chart", "big_stat", "big_date", "hero_stat",
                            "stat_wall", "big_word", "number_badge", "vox_counter"}
        if _num_type and _has_number(title):
            _r = _number_pos_ratio(text)
            if _r is not None:
                try:
                    _lead = float(os.environ.get("COUNTUP_LEAD", "0.35") or 0.35)
                except (TypeError, ValueError):
                    _lead = 0.35
                _spoken = start + _r * dur
                ev_start = min(max(start, _spoken - _lead), max(start, end - 0.8))
        # CUADRAR el TEXTO con la VOZ (2026-09-05, el usuario: "el motion aparece 5 segundos
        # antes de cuando se dice… mientras se dice, se vaya escribiendo"): para los overlays de
        # texto se localiza DÓNDE empieza su frase en la narración de la escena y el evento
        # arranca ahí. narrative_text además recibe revealSeconds = lo que tarda la voz en
        # decir la frase → se escribe al ritmo de la locución.
        _reveal_s = 0.0
        if typ in _PHRASE_ANCHOR_TYPES and os.environ.get("MOTION_PHRASE_ANCHOR", "1").strip().lower() in {"1", "true", "yes", "on"}:
            _anchor_phrase = ""
            if typ == "narrative_text":
                _anchor_phrase = title
            elif typ in {"quote_card", "quote_line"}:
                _anchor_phrase = _plain(scene.get("motion_subtitle") or "") or title
            elif typ == "label_pair":
                _anchor_phrase = (items[0] if items else "") or title
            else:
                _anchor_phrase = title
            _r2 = _phrase_pos_ratio(text, _anchor_phrase)
            if _r2 is None:
                # No aparece literal (rótulo parafraseado): se busca la palabra MÁS DISTINTIVA
                # del rótulo dentro de la narración (la más larga que exista en el texto).
                _cands = sorted({w for w in _norm_words(_anchor_phrase) if len(w) >= 5},
                                key=len, reverse=True)
                for _w in _cands[:4]:
                    _r2 = _phrase_pos_ratio(text, _w)
                    if _r2 is not None:
                        break
            if _r2 is not None:
                _spoken2 = start + _r2 * dur
                ev_start = min(max(start, _spoken2 - 0.25), max(start, end - 1.2))
                if typ == "narrative_text":
                    _reveal_s = _phrase_speak_seconds(text, title, dur)
            else:
                # Ni así: NO arrancar en el corte (el usuario 2026-09-06: "los motions aparecen
                # mucho antes de lo que suenan"). Se entra a un tercio de la ventana, que es
                # donde de media cae el contenido que el rótulo comenta.
                try:
                    _lead_frac = float(os.environ.get("MOTION_BLIND_LEAD_FRAC", "0.33") or 0.33)
                except (TypeError, ValueError):
                    _lead_frac = 0.33
                ev_start = min(max(start, start + dur * _lead_frac), max(start, end - 1.2))
        if typ in {"callout_label", "tag_label", "frame_box"}:
            # Un callout señala UN plano: si el clip cambia, la flecha apuntaría al vacío.
            _dur_cap = min(float(_dur_cap), 4.5)
        if typ in _IMAGE_OVERLAYS:
            # Una composición de foto que tapa el metraje no debe quedarse 9 s en pantalla.
            try:
                _fs_cap = float(os.environ.get("DOC_FULLSCREEN_MAX_S", "5.5") or 5.5)
            except (TypeError, ValueError):
                _fs_cap = 5.5
            _dur_cap = min(float(_dur_cap), _fs_cap)
        ev_start = round(max(0, ev_start), 3)

        # 🚫 SUPRIMIR ROTULOS-BASURA (bug real BeyondMilitary 2026-07-13: los lower-thirds
        # mostraban las primeras palabras de la frase → "ESO MOVIMIENTO CARRETERA DOS",
        # "SUMINISTROS AVANZAN RETAGUARIA HACIA"). Un rótulo con un fragmento de frase sin
        # sentido es PEOR que nada. Para los tipos de TEXTO puro, si el título no es una
        # ETIQUETA de verdad (no lleva cifra/fecha ni NOMBRE PROPIO), se OMITE el overlay
        # → metraje limpio (estilo BeyondMilitary: rótulo solo cuando aporta un dato).
        # MOTION_SUPPRESS_JUNK=0 lo desactiva. OJO: SOLO se filtran los títulos FABRICADOS por el
        # pipeline (cifra suelta / nombre propio extraído); un motion_title CURADO del planner
        # (raw_title) es deliberado y NO se somete a este gate — su check por-tokens fallaba con
        # nombres partidos por iniciales ('Joaquin L. Chapo Guzman' → 'Chapo' quedaba a inicio de
        # frase) o con mojibake ('Guzm�n'), y tiraba rótulos legítimos (bug: se perdía El Chapo).
        _text_label_types = {"lower_third", "keyword_card", "title_full", "big_word",
                             "quote", "section_title", "big_quote"}
        if (typ in _text_label_types and not raw_title
                and os.environ.get("MOTION_SUPPRESS_JUNK", "1").strip().lower()
                not in {"0", "false", "no", "off"}):
            _has_num = bool(re.search(r"\d", title))
            # nombre propio = palabra Capitalizada a MITAD de frase en el texto original
            _propers = []
            for _snt in re.split(r"(?<=[.!?])\s+", str(text or "")):
                _tk = _snt.split()
                for _jj, _ww in enumerate(_tk):
                    _cw = re.sub(r"[^\wÁÉÍÓÚÑÜáéíóúñü]", "", _ww)
                    if _jj >= 1 and re.match(r"^[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}$", _cw):
                        _propers.append(_plain(_cw))
            _title_plain = _plain(title)
            _has_proper = any(_p in _title_plain for _p in _propers) or bool(re.search(r"\b[A-ZÁÉÍÓÚÑ]{2,6}\b", title))
            if not (_has_num or _has_proper):
                continue   # sin dato que mostrar → metraje limpio, sin rótulo basura

        # Formato español de miles: "1,400 metros" (coma anglosajona) en es se lee
        # como "uno coma cuatro" → se normaliza a "1.400". Solo coma seguida de
        # EXACTAMENTE 3 dígitos (los decimales es-ES tipo "1,5" no se tocan).
        if (lang or "es").lower().startswith("es"):
            title = re.sub(r"(?<=\d),(?=\d{3}\b)", ".", title)

        # A number/count-up may be delayed to the word spoken in the sentence
        # (``ev_start`` above).  The old duration calculation then restored the
        # full 3.6–4.6 s floor without re-clamping it to the scene end, so an
        # overlay could bleed into the next SRT cue (e.g. s9: 57.09–60.69 for a
        # 52.56–58.40 scene).  That made the Remotion preflight reject the whole
        # render and the runner silently fell back to FFmpeg without motions.
        # Keep the readable minimum by moving the event start earlier when
        # necessary, but never allow its end to cross this scene's hard cut.
        _window_len = max(0.0, end - start)
        _min_event = min(float(_dur_floor), _window_len)
        if _window_len > 0.0:
            ev_start = min(max(float(ev_start), start), max(start, end - _min_event))
            _event_duration = min(float(_dur_cap), max(0.0, end - ev_start))
            if _event_duration < _min_event:
                ev_start = start
                _event_duration = min(float(_dur_cap), _window_len)
        else:
            _event_duration = 0.0

        events.append({
            "id": f"s{i}_main",
            "type": typ,
            # Kicker ("PUNTO CLAVE/COMPARACIÓN/CONCEPTO") OFF por defecto: el usuario lo ve
            # forzado y las referencias (VidRush) no lo llevan. Reactivable con MOTION_KICKERS=1.
            "kicker": (_kicker_label(typ, lang)
                       if os.environ.get("MOTION_KICKERS", "0").strip().lower() in {"1", "true", "yes", "on"}
                       else ""),
            "start": ev_start,
            "duration": round(_event_duration, 3),
            "title": title[:72],
            # Subtítulo de motion = SOLO copy corto y deliberado del planner.
            # Nunca reutilizar automáticamente la frase SRT completa: en documental la voz
            # ya cuenta la historia y ese fallback convertía un gráfico puntual en subtítulo
            # quemado (además de competir con el plano). Si MiniMax no entrega
            # ``motion_subtitle`` explícito, el evento queda limpio; ``motion_items`` sigue
            # disponible para los componentes que realmente necesiten etiquetas breves.
            "subtitle": _plain(scene.get("motion_subtitle"))[:135],
            "items": items,
            "design": _plain(scene.get("motion_design") or scene.get("motion_purpose") or "")[:280],
            "objectHint": _object_hint(scene, text, title),
            # Tipo de esquema decidido por MiniMax: mantiene separada la intención (planta,
            # alzado, solar, comparación…) de la copia visible del título.
            "schematicKind": _plain(scene.get("motion_schematic_kind")
                                     or scene.get("schematic_kind")
                                     or scene.get("motion_kind") or "").strip()[:32].lower(),
            "rank": real_rank,
            "side": side,
            "accent": accent,
            # TEMA por nicho (tipografía + colores): el canal lo elige (ch.remotionTheme),
            # el pipeline lo pasa por PIPELINE_MOTION_THEME. video.tsx aplica fuente/colores.
            "theme": (os.environ.get("PIPELINE_MOTION_THEME") or "documentary").strip().lower(),
            # TIPOGRAFÍA configurable por canal (branding): font-family CSS; vacío = la del tema.
            "font": (os.environ.get("PIPELINE_MOTION_FONT") or "").strip(),
            # MAPA con descenso desde las nubes (CloudMapZoom): el planner aporta el mapa elegido
            # (motion_image = ruta del asset-mapa), el punto (motion_target_x/y 0..1) y la
            # localización (motion_loc). prepare_remotion_project copia la imagen a public/.
            "image": (scene.get("motion_image") or scene.get("map_image")
                      # Las composiciones editoriales usan el asset de LA escena,
                      # ya sea foto o un frame extraído del clip. No caen a un
                      # fondo decorativo si el planner ha seleccionado una de ellas.
                      or (str(scene.get("asset_path") or "")
                          if (typ in _VIDRUSH_MOTIONS or typ in _IMAGE_OVERLAYS) else "")
                      # VOX: el recorte sale del PROPIO asset de la escena (imagen) —
                      # prepare_remotion_project lo procesa (rembg→halftone) y lo stagea.
                      or (str(scene.get("asset_path") or "")
                          if (typ in {"vox_scene", "vox_counter"}
                              and str(scene.get("asset_type") or "") == "image") else "")
                      or "").strip(),
            # Segundo documento/foto: si el plan trae una RUTA real se usa; si trae una
            # descripción (MiniMax escribe "foto del telar" en motion_image2) o nada, la
            # matriz/galería toma el asset de la escena VECINA (otra evidencia real del mismo
            # vídeo). Antes eso acababa en "sin segunda evidencia; se omite" → lower_third.
            "image2": _second_evidence(scene, scenes, i, typ),
            # DOCUMENTAL: video.tsx viste stat_big/section_title/lower_third con la gramática
            # de las referencias (cifra enorme centrada, barra de capítulo, etiqueta de papel).
            "docStyle": bool(_documentary),
            # Idioma del vídeo → rótulos fijos de las composiciones traducidos.
            "lang": (lang or "es"),
            # narrative_text: segundos que tarda la voz en decir la frase (se escribe a ese ritmo).
            **({"revealSeconds": round(_reveal_s, 2)} if _reveal_s > 0 else {}),
            "assetType": str(scene.get("asset_type") or "").strip().lower(),
            # halftone B/N para la escena de personajes; el contador lleva recorte a
            # color. La clave SOLO existe en eventos vox (antes se colaba
            # "voxHalftone": false en TODOS los props, también sin el modo activo).
            **({"voxHalftone": typ == "vox_scene"} if typ in {"vox_scene", "vox_counter"} else {}),
            "targetX": _as_float(scene.get("motion_target_x"), 0.5),
            "targetY": _as_float(scene.get("motion_target_y"), 0.45),
            "locName": _plain(scene.get("motion_loc") or scene.get("location") or "")[:40],
            "flag": (scene.get("motion_flag") or scene.get("flag") or "").strip(),
            # El CONTORNO se calcula en el STAGING (prepare_remotion_project), DESPUÉS de
            # preparar el mapa (quitar marco/marca de agua, 16:9, reescalar): el recorte cambia
            # los bounds y el contorno debe recalcularse con los bounds finales para encajar
            # al píxel. Aquí solo se transportan los datos crudos.
            "country": (scene.get("motion_country") or scene.get("country") or "").strip()[:60],
            "mapBounds": scene.get("motion_map_bounds") or scene.get("map_bounds"),
            "mapCrop": scene.get("motion_map_crop"),
            # 'modern' = mapa oscuro neón (referencia nav/AE del usuario) — POR DEFECTO (el
            # usuario: "debe ser justo como el moderno"). 'natural' = satélite doc, opt-in.
            "mapStyle": (scene.get("motion_map_style") or scene.get("map_style") or "modern").strip().lower(),
            # RUTA luminosa opcional: destino (0..1 en el mapa ORIGINAL; staging lo remapea) + etiqueta.
            "routeToX": scene.get("motion_route_x"),
            "routeToY": scene.get("motion_route_y"),
            "routeToName": _plain(scene.get("motion_route_name") or "")[:40],
            "outline": [],
            # MAPA VECTORIAL (GeoMap d3-geo/world-atlas): si el país resuelve, estas claves
            # activan el motor vectorial (formas reales + cámara continua estilo Vox); si no,
            # quedan ausentes y renderEvent usa el mapa ráster de siempre.
            **(_vector_geo(scene, accent=accent, strike=_conflict_theme) if typ in {"map_zoom", "cloud_map", "map_descend",
                                             "map_route", "map_callout", "map"} else {}),
        })
        # Registra las escenas 'none' a las que ESTE pase les añadió overlay → el guardia de
        # no-consecutivas de arriba impide que dos escenas seguidas reciban overlay añadido.
        if _is_none_scene and motion_level == "high":
            _added_idx.add(i)

        # Low tambien necesita ritmo, pero solo si hay tiempo real de lectura.
        # En escenas cortas un segundo grafico se siente acelerado.
        # Con motion_level=low, no añadir segundo overlay.
        if motion_level == "low":
            continue
        # UN SOLO gráfico por escena. El segundo overlay solía solaparse con el
        # primero ("dos a la vez" / saturado, como vio el usuario). Estilo VidRush =
        # un titular/callout a la vez. Reactivable con MOTION_SECOND_OVERLAY=1.
        allow_second_overlay = (
            os.environ.get("MOTION_SECOND_OVERLAY", "0").strip().lower() in {"1", "true", "yes", "on"}
            and (quality == "high" or motion_level == "high") and typ not in {
                "ae_documentary_rank", "ae_specs_plate", "lower_third",
                "ae_object_rig", "ae_device_scene", "ae_code_orchestrator",
            })
        if allow_second_overlay and dur >= 6.6 and (scene.get("avatar") or "") != "fullscreen":
            second_start = start + min(max(3.2, dur * 0.58), max(3.2, dur - 2.2))
            if second_start + 0.9 < end:
                words = _words(text)
                second_title = " ".join(words[-4:])[:58] if words else title
                second_type = "timeline" if typ != "timeline" and i % 2 == 0 else "big_word"
                if quality in ("mid", "high") and i % 3 == 0:
                    second_type = "before_after" if typ != "before_after" else "evidence_card"
                if quality == "high" and re.search(r"\b(\d{2,4}|%|dato|datos|cifra)\b", text.lower()):
                    second_type = "stat_wall"
                if quality == "high" or (premium_hint and motion_level == "high"):
                    second_type = _high_motion_type(second_type, text, i + 1)
                second_type = _avatar_safe_type(scene, second_type)
                second_side = side
                if not (scene.get("avatar") or ""):
                    second_side = "right" if side == "left" else "left"
                events.append({
                    "id": f"s{i}_detail",
                    "type": second_type,
                    "start": round(second_start, 3),
                    "duration": round(min(max(0.9, end - second_start), max(2.2, min(dur * 0.36, 5.4))), 3),
                    "title": second_title or title,
                    "subtitle": text[:120],
                    "items": _motion_items(scene, text, ["Contexto", "Dato", "Cambio", "Resultado"]),
                    "design": _plain(scene.get("motion_design") or scene.get("motion_purpose") or "")[:280],
                    "objectHint": _object_hint(scene, text, second_title or title),
                    "rank": _rank_from_text(text, i),
                    "side": second_side,
                    "accent": colors[(i + 1) % len(colors)],
                })

    if not events:
        events.append({
            "id": "fallback",
            "type": "title_full",
            "start": 0.2,
            "duration": min(4.0, duration),
            "title": "Motion graphics",
            "subtitle": "Capa visual generada localmente",
            "accent": (os.environ.get("MOTION_ACCENT") or "#e8b923").strip(),
        })

    events = sorted(events, key=lambda e: e["start"])
    # CIFRAS FANTASMA Y DUPLICADAS (el usuario: "aparece 10.000 y no se dice nada"):
    #  • una cifra SOLO puede aparecer si su número se DICE en la narración de ESA escena
    #    (en dígitos o en palabras: _number_pos_ratio ya detecta ambos);
    #  • un mismo título de cifra no se repite dos veces en el vídeo (se queda el que sí se dice).
    _txt_by_idx = {}
    for _i, _s in enumerate(scenes or []):
        _txt_by_idx[f"s{_i}_main"] = _plain(_s.get("text") or "")
    _NUMTYPES = {"stat_big", "big_stat", "big_date", "hero_stat", "stat_wall", "number_badge", "vox_counter"}
    _seen_titles = set()
    _filtered = []
    for e in events:
        et = str(e.get("type", ""))
        ttl = _plain(str(e.get("title") or ""))
        if et in _NUMTYPES and _has_number(ttl):
            _stxt = _txt_by_idx.get(str(e.get("id")), "")
            if _stxt and _number_pos_ratio(_stxt) is None:
                print(f"[remotion] Cifra fantasma descartada: '{ttl}' (no se dice en su escena)", flush=True)
                continue
            _k = re.sub(r"\D", "", ttl)
            if _k and _k in _seen_titles:
                print(f"[remotion] Cifra duplicada descartada: '{ttl}'", flush=True)
                continue
            if _k:
                _seen_titles.add(_k)
        # RÓTULO-ECO (el usuario: "cabeza de playa no tiene sentido ahí"): un big_word que solo
        # REPITE una frase que la voz acaba de decir es relleno → fuera. (Las CIFRAS y los
        # section_title de CAPÍTULO sí repiten a propósito: son anclas/cartelas curadas — un
        # section_title sale de un motion_title del planner o de la promoción de capítulo, nunca
        # de un fragmento del SRT, así que puntuar la narración con él es editorial, no basura.)
        if et in {"big_word"} and len(ttl.split()) >= 2:
            # comparar contra la escena Y sus vecinas (el SRT puede partir la frase justo ahí)
            _sid = str(e.get("id"))
            try:
                _si = int(_sid[1:-5]) if _sid.startswith("s") and _sid.endswith("_main") else -1
            except ValueError:
                _si = -1
            _ctx = " ".join(_txt_by_idx.get(f"s{_j}_main", "") for _j in (_si - 1, _si, _si + 1))
            if _ctx.strip() and _strip_accents(ttl.lower()) in _strip_accents(_ctx.lower()):
                print(f"[remotion] Rótulo-eco descartado: '{ttl}' (repite la narración)", flush=True)
                continue
        _filtered.append(e)
    events = _filtered

    # CAP DE MAPAS (el usuario: "9 mapas y todos rotos" — su regla es 1-2 por
    # vídeo). Se conservan solo los MAX_MAPS primeros map_*; el resto se degrada a
    # lower_third (el texto sigue, sin mapa en blanco). Los mapas SIN localización
    # resoluble (locName vacío Y sin país/target) se degradan también aquí — un
    # mapa mundial en blanco sobre "el océano" es peor que un rótulo limpio.
    try:
        _max_maps = int(os.environ.get("MAX_MAPS_PER_VIDEO", "2") or 2)
    except ValueError:
        _max_maps = 2
    _MAP_TYPES = {"map_zoom", "cloud_map", "map_descend", "map_route", "map_callout", "map"}
    _maps_kept = 0
    for e in events:
        if str(e.get("type") or "") in _MAP_TYPES:
            _has_place = bool(str(e.get("locName") or "").strip()
                              or str(e.get("country") or "").strip())
            if _maps_kept >= _max_maps or not _has_place:
                # degradar a rótulo (conserva el texto, quita el mapa roto/de más)
                e["type"] = "lower_third"
                print(f"[remotion] Mapa degradado a rótulo ({'sin lugar' if not _has_place else 'exceso >'+str(_max_maps)}): "
                      f"{str(e.get('locName') or e.get('title') or '')[:40]}", flush=True)
            else:
                _maps_kept += 1

    # PROTEGER LA CIFRA: si una cifra (stat_big/chart con count-up) va seguida demasiado pronto
    # por un overlay MENOR, se DESCARTA ese overlay (no se recorta la cifra) → "20.000" cuenta
    # (0.6s) y AGUANTA (~1.2s) sin que el siguiente gráfico la pise. Entre dos cifras no se toca.
    _BIG = {"stat_big", "chart", "big_stat", "big_date", "hero_stat",
            "stat_wall", "big_word", "number_badge", "vox_counter", "vox_chart"}
    try:
        _protect = max(1.0, float(os.environ.get("COUNTUP_PROTECT", "1.8") or 1.8))
    except (TypeError, ValueError):
        _protect = 1.8
    _kept = []
    for e in events:
        if _kept and _kept[-1].get("type") in _BIG and e.get("type") not in _BIG:
            if float(e["start"]) < float(_kept[-1]["start"]) + _protect:
                continue  # descarta el overlay menor que pisaría la cifra
        _kept.append(e)
    events = _kept
    # Clamp ANTI-SOLAPE ESTRICTO: NUNCA dos motion graphics a la vez (ni una cifra central +
    # una etiqueta de esquina — el usuario lo vio mal). Cada gráfico TERMINA antes de que
    # empiece el siguiente.
    for a, b in zip(events, events[1:]):
        # Dos composiciones Vidrush ya tienen entradas/salidas internas y están ancladas al
        # corte SRT; quitarles 120 ms acortaba una ventana válida de 3.8s a 3.68s y el QC
        # estricto las rechazaba. En un borde exacto no hay solape de frames (Sequence termina
        # justo cuando empieza la siguiente), así que conservamos el corte completo.
        _edge_gap = 0.0 if (str(a.get("type") or "") in _VIDRUSH_MOTIONS
                             or str(b.get("type") or "") in _VIDRUSH_MOTIONS) else 0.12
        max_end = b["start"] - _edge_gap
        if a["start"] + a["duration"] > max_end:
            a["duration"] = round(max(0.8, max_end - a["start"]), 3)
    events = [e for e in events if e.get("duration", 0) >= 0.8]
    # EQUILIBRIO (el usuario: "demasiados textos, muchos innecesarios — que sea equilibrado"):
    # cap por DENSIDAD ≈ 1 overlay cada MOTION_MIN_SPACING seg (def. 6). Prioridad a las piezas
    # que APORTAN (mapa/chart/cifras/títulos de sección); los rótulos pequeños caen primero.
    try:
        _spacing = max(3.0, float(os.environ.get("MOTION_MIN_SPACING", "6.0") or 6.0))
    except (TypeError, ValueError):
        _spacing = 6.0
    _budget = max(3, int(round(duration / _spacing)))
    _overlays = [e for e in events if not str(e.get("type", "")) in ("film_burn", "section_flash", "transition")]
    if len(_overlays) > _budget:
        # Mapas y chart por DELANTE de las cifras (el usuario quiere el mapa; si chocan en
        # la intro, gana el mapa y la cifra cercana cae — "máx 1 motion en la intro").
        _PRIO = {"map_zoom": -1, "cloud_map": -1, "map_descend": -1, "map_route": -1, "chart": -1,
                 "vox_chart": -1, "vox_scene": -1,
                 # el ESQUEMA en corte es una pieza GRANDE (como el mapa): resume varias escenas
                 # y ya suprimió los overlays de su ventana → nunca cae como relleno.
                 "cross_section": -1,
                 "stat_big": 0, "big_stat": 0, "big_date": 0, "hero_stat": 0, "vox_counter": 0,
                 "section_title": 1, "title_full": 1, "vox_paper": 1}
        _ordered = sorted(_overlays, key=lambda x: (_PRIO.get(str(x.get("type")), 2), x["start"]))
        # hueco mínimo 45% del spacing (2.7s con 6s): así la FECHA del arranque y el MAPA
        # conviven en la intro (el usuario quiere ambos; antes 55% descartaba la fecha).
        def _fits(_e):
            return not any(abs(_e["start"] - u) < _spacing * 0.45 for u in _used)
        _keep, _used, _seen_t = [], [], set()
        # PASE 1 — VARIEDAD: una pieza de cada TIPO (mapa, cifra, título, rótulo…), en orden de
        # prioridad, para que el mix sea RICO (el usuario: "faltan tipos del repertorio") y no
        # sobrevivan 5 lower-thirds iguales mientras se descartan mapa/chart/cifra.
        for e in _ordered:
            if len(_keep) >= _budget:
                break
            _t = str(e.get("type"))
            if _t in _seen_t or not _fits(e):
                continue
            _keep.append(e); _used.append(e["start"]); _seen_t.add(_t)
        # PASE 2 — RELLENO por prioridad hasta agotar el presupuesto.
        _kids = {id(e) for e in _keep}
        for e in _ordered:
            if len(_keep) >= _budget:
                break
            if id(e) in _kids or not _fits(e):
                continue
            _keep.append(e); _used.append(e["start"]); _kids.add(id(e))
        _kept_ids = {id(e) for e in _keep}
        _dropped = len(_overlays) - len(_keep)
        events = [e for e in events if id(e) in _kept_ids
                  or str(e.get("type", "")) in ("film_burn", "section_flash", "transition")]
        events = sorted(events, key=lambda e: e["start"])
        print(f"[remotion] Equilibrio motion: {_dropped} overlay(s) de relleno descartado(s) "
              f"(cap {_budget} para {duration:.0f}s)", flush=True)
    events = _thin_motion_events(events, _max_motion_events(quality, motion_level))
    # TRANSICIONES VISUALES (overlay sweep/dip): DESACTIVADAS por defecto. El usuario reportó
    # varias veces que "no cuadran" (el overlay deriva del corte real renderizado). Cortes LIMPIOS
    # siempre cuadran y son profesionales; el SFX de transición (swish, en pipeline) se mantiene
    # aparte y SÍ suena en los cortes. Reactivable con MOTION_VISUAL_TRANSITIONS=1 cuando se afine.
    if os.environ.get("MOTION_VISUAL_TRANSITIONS", "0").strip().lower() in {"1", "true", "yes", "on"}:
        _td = float(os.environ.get("TRANSITION_SECONDS", "0.45") or 0.45)
        _trans = []
        _scn = scenes or []
        for i, scene in enumerate(_scn):
            if i == 0 or i % 3 != 0:  # saltar la primera; ~1 de cada 3 cortes ≈ 30%
                continue
            # SOLO en un CORTE REAL (cambia el asset). Si la escena reusa el MISMO asset que la
            # anterior (forward-fill o un Ken Burns partido en varias escenas), NO hay corte
            # visual → la transición se vería "en medio del clip" (el fallo que reportó el
            # usuario). En ese caso se salta. Centrada en scene.start = el corte exacto.
            _prev = _scn[i - 1] or {}
            _cur_a = str(scene.get("asset_path") or scene.get("file") or "").strip()
            _prev_a = str(_prev.get("asset_path") or _prev.get("file") or "").strip()
            if _cur_a and _cur_a == _prev_a:
                continue
            st = float(scene.get("start", 0) or 0)
            if st <= _td or st >= duration - 0.3:
                continue
            _trans.append({"id": f"tr{i}", "type": "transition",
                           "start": round(st - _td / 2, 3), "duration": round(_td, 3),
                           "title": "", "accent": _accent})
        events = events + _trans

    # FILM-BURN de SECCIÓN: destello cálido SOLO en cambios de sección grandes (no en cada
    # corte, como pidió el usuario). Cadencia ~cada MOTION_SECTION_SECONDS, anclada al PRIMER
    # corte REAL tras cada umbral (nunca a mitad de un clip). En vídeos cortos (<cadencia) no
    # sale ninguno. Gate MOTION_SECTION_TRANSITIONS (ON por defecto). No toca el montaje.
    # DOCUMENTAL (2026-09-05, el usuario: "que no hay efectos de transiciones ni nada, que queda
    # fatal"): sin film-burns por defecto; MOTION_SECTION_TRANSITIONS=1 los reactiva.
    _sec_default = "0" if os.environ.get("PIPELINE_DOCUMENTARY", "0").strip().lower() in {"1", "true", "yes", "on"} else "1"
    if os.environ.get("MOTION_SECTION_TRANSITIONS", _sec_default).strip().lower() not in {"0", "false", "no", "off"}:
        try:
            _sec_gap = max(20.0, float(os.environ.get("MOTION_SECTION_SECONDS", "95") or 95))
        except ValueError:
            _sec_gap = 95.0
        try:
            _fb = max(0.3, min(1.5, float(os.environ.get("FILM_BURN_SECONDS", "0.6") or 0.6)))
        except ValueError:
            _fb = 0.6
        _theme_name = (os.environ.get("PIPELINE_MOTION_THEME") or "documentary").strip().lower()
        _scn = scenes or []
        # Cortes REALES (cambia el asset): únicos puntos válidos para un film-burn.
        _cuts = []
        for i, scene in enumerate(_scn):
            if i == 0:
                continue
            st = float(scene.get("start", 0) or 0)
            _prev = _scn[i - 1] or {}
            _ca = str(scene.get("asset_path") or scene.get("file") or "").strip()
            _pa = str(_prev.get("asset_path") or _prev.get("file") or "").strip()
            if _ca and _ca == _pa:
                continue
            if 1.0 < st < duration - 1.0:
                _cuts.append(st)
        # Candidatos: (a) inicios de SECCIÓN reales (títulos de sección del plan) — es el
        # significado exacto de "entre secciones"; (b) cadencia temporal de respaldo para tramos
        # largos sin título. Cada candidato se ancla al corte real más cercano + dedup (≥8s).
        _cands = [float(e.get("start", 0) or 0) for e in events
                  # vox_paper ES el section_title del modo Vox — sin él los film-burns
                  # (y su SFX de sección) perdían el anclaje con el estilo activo.
                  if str(e.get("type", "")) in ("section_title", "title_full", "ae_depth_title", "vox_paper")]
        _t = _sec_gap
        while _t < duration - 1.0:
            _cands.append(_t)
            _t += _sec_gap
        _burn_at = []
        for c in sorted(_cands):
            if not _cuts:
                break
            near = min(_cuts, key=lambda x: abs(x - c))
            if abs(near - c) > _sec_gap * 0.6:
                continue  # no hay un corte cerca → no forzar el destello
            if any(abs(near - b) < 8.0 for b in _burn_at):
                continue  # ya hay un film-burn muy cerca
            _burn_at.append(near)
        _burns = [{"id": f"fb{k}", "type": "film_burn",
                   "start": round(max(0.0, bt - _fb * 0.35), 3), "duration": round(_fb, 3),
                   "title": "", "accent": _accent, "theme": _theme_name}
                  for k, bt in enumerate(sorted(_burn_at))]
        events = events + _burns
    # ── ESTILO DE MAPA: ROTACIÓN determinista VECTORIAL ↔ NUBES (2026-07-17) ──────────────────
    # Se decide AQUÍ, al final, sobre los mapas que SOBREVIVEN a los filtros (cap de mapas,
    # presupuesto…): así no se prepara ráster para un mapa que luego se degrada a rótulo.
    #   • 'vector' → GeoMap minimalista (el look aprobado). Solo se sella si el evento TIENE datos
    #     geo; si no los tiene, se deja el mapStyle de siempre ('modern') → CloudMapZoom idéntico
    #     a hoy (sellar 'vector' ahí le habría cambiado el grade a satélite: regresión).
    #   • 'clouds' → CloudMapZoom con descenso entre nubes. Necesita ráster: si no se puede
    #     resolver, se cae al vectorial (nunca un mapa roto/en blanco).
    # Solo los tipos que CloudMapZoom sabe pintar (map_zoom/cloud_map/map_descend); map_route y
    # map_callout siguen su camino de siempre (GeoMap/MapRoute) sin tocarse.
    _CLOUD_CAPABLE = {"map_zoom", "cloud_map", "map_descend"}
    _map_i = 0
    for _e in events:
        if str(_e.get("type") or "") not in _CLOUD_CAPABLE:
            continue
        _has_geo = bool(_e.get("focusName") or _e.get("highlight"))
        _style = _map_style_for(_map_i)
        _map_i += 1
        if _style == "clouds":
            _c, _b = _map_raster_autoresolve(
                _e, str(_e.get("country") or "").strip() or str(_e.get("focusName") or "").strip(),
                _e.get("mapBounds"))
            if str(_e.get("image") or "").strip():
                # el país/bounds viajan al staging: prepare_map recorta la ventana regional y
                # geo_outline dibuja el contorno real sobre el ráster.
                _e["country"], _e["mapBounds"] = _c, _b
                _e["mapStyle"] = "clouds"
                # prints en ASCII: la consola del pipeline es cp1252 y un '->' unicode la revienta.
                print(f"[remotion] Mapa #{_map_i} -> estilo NUBES (CloudMapZoom) "
                      f"'{str(_e.get('locName') or '')[:30]}'", flush=True)
                continue
            print(f"[remotion] Mapa #{_map_i}: sin raster utilizable -> estilo VECTORIAL", flush=True)
        if _has_geo:
            _e["mapStyle"] = "vector"
            print(f"[remotion] Mapa #{_map_i} -> estilo VECTORIAL (GeoMap) "
                  f"'{str(_e.get('locName') or '')[:30]}'", flush=True)

    # LOCALE de las CIFRAS (2026-07-17): video.tsx formatea el count-up con toLocaleString y tenía
    # 'es-ES' fijo → un vídeo en INGLÉS mostraba "1,5KM" (coma española) en vez de "1.5KM", y en
    # los idiomas extra pasaba igual. Se sella el locale del idioma del vídeo en cada evento.
    _LOCALES = {"es": "es-ES", "en": "en-US", "pt": "pt-BR", "fr": "fr-FR", "de": "de-DE",
                "it": "it-IT", "nl": "nl-NL", "pl": "pl-PL", "ru": "ru-RU", "tr": "tr-TR",
                "id": "id-ID", "hi": "hi-IN", "ar": "ar-EG", "ja": "ja-JP", "ko": "ko-KR"}
    _loc = _LOCALES.get((lang or "es").strip()[:2].lower(), "es-ES")
    for _e in events:
        _e.setdefault("locale", _loc)
    return events


def _safe_project_id(value: str | None = None) -> str:
    base = value or f"{os.getpid()}_{time.time_ns()}"
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(base)).strip("._-")
    return (safe or f"{os.getpid()}_{time.time_ns()}")[:90]


def prepare_remotion_project(video_path: str, scenes: list[dict] | None = None,
                             quality: str = "low",
                             motion_level: str = "mid",
                             lang: str = "es",
                             motion_style_hint: str = "",
                             project_id: str | None = None) -> dict:
    src = Path(video_path).resolve()
    if not src.exists():
        raise FileNotFoundError(f"Video base no encontrado: {src}")
    PUBLIC.mkdir(parents=True, exist_ok=True)
    meta = _video_meta(str(src))
    duration = float(meta["duration"])
    match_source = os.environ.get("REMOTION_MATCH_SOURCE", "1").strip().lower() not in {
        "0", "false", "no", "off",
    }
    width = int(_env_int("REMOTION_OUTPUT_WIDTH", meta["width"] if match_source else 1920, min_value=16, max_value=7680))
    height = int(_env_int("REMOTION_OUTPUT_HEIGHT", meta["height"] if match_source else 1080, min_value=16, max_value=4320))
    fps_value = _env_float("REMOTION_OUTPUT_FPS", meta["fps"] if match_source else 30.0, min_value=1.0, max_value=120.0)
    fps = int(round(fps_value)) if abs(fps_value - round(fps_value)) < 0.01 else fps_value
    safe_id = _safe_project_id(project_id)
    source_name = f"source_{safe_id}.mp4"
    props_name = f"props_{safe_id}.json"
    source_path = PUBLIC / source_name
    # AUTO-LIMPIEZA (2026-07-16): cada render copiaba source_{id}.mp4 a public/ y NUNCA se borraban
    # → se acumulaban ~30 GB de vídeos de trabajos viejos → el bundler de Remotion PETABA al copiar
    # public/ entero ("Remotion fallo rc=1" en internalBundle, rompía TODOS los overlays). Antes de
    # copiar el source de ESTE render, se borran los source_/props_ de OTROS renders (fuentes/fondos/
    # banderas/mapas se conservan). REMOTION_KEEP_SOURCES=1 lo desactiva.
    if os.environ.get("REMOTION_KEEP_SOURCES", "").strip().lower() not in {"1", "true", "yes", "on"}:
        # ⚠ AGE-BASED (2026-07-16): borrar SOLO ficheros ANTIGUOS (mtime > REMOTION_SOURCE_MAX_AGE,
        # def. 1200 s = 20 min) y NUNCA los de ESTE render. Antes se borraba TODO source_/props_
        # que no fuera el actual → con DOS renders a la vez, este borraba el source recién copiado
        # del OTRO render a mitad de su bundle → Remotion bundler rc=1 (rompió un render de salud
        # real). El corte por edad mantiene la limpieza anti-30 GB sin tocar un render concurrente.
        try:
            _now = time.time()
            try:
                _stale = float(os.environ.get("REMOTION_SOURCE_MAX_AGE", "1200") or 1200)
            except (TypeError, ValueError):
                _stale = 1200.0
            for _old in list(PUBLIC.glob("source_*.mp4")) + list(PUBLIC.glob("props_*.json")):
                if _old.name in {source_name, props_name}:
                    continue
                try:
                    if _now - os.path.getmtime(_old) > _stale:
                        _old.unlink()
                except OSError:
                    pass
        except Exception:
            pass
    shutil.copy2(src, source_path)
    events = build_motion_events(
        scenes or [], duration, quality,
        motion_level=motion_level,
        lang=lang,
        motion_style_hint=motion_style_hint,
    )
    # Las composiciones Vidrush necesitan un fotograma o documento REAL de la
    # escena. stagea una foto tal cual; para un clip extrae un frame local. Así
    # no se pasan rutas de disco a Chromium ni se recicla un placeholder del demo.
    _vidrush_cache: dict[str, str] = {}

    def _stage_vidrush_asset(raw: str, slot: str) -> str:
        value = str(raw or "").strip()
        if not value:
            return ""
        if value.startswith(("http:", "https:", "data:")):
            return value
        if value in _vidrush_cache:
            return _vidrush_cache[value]
        try:
            source = Path(value.replace("file:///", "").replace("file://", "")).resolve()
            if not source.exists() and (PUBLIC / value).exists():
                _vidrush_cache[value] = value
                return value
            if not source.exists():
                return ""
            stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", source.stem)[:60] or "asset"
            dest_name = f"vidrush_{_safe_project_id(project_id)}_{slot}_{stem}.jpg"
            dest = PUBLIC / dest_name
            if source.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}:
                # Preserve an image's codec when possible; Chromium and Remotion
                # accept it and this avoids a needless recompression.
                dest_name = f"vidrush_{_safe_project_id(project_id)}_{slot}_{stem}{source.suffix.lower()}"
                dest = PUBLIC / dest_name
                shutil.copy2(source, dest)
            else:
                run = subprocess.run(
                    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", "0.25", "-i", str(source),
                     "-frames:v", "1", "-q:v", "2", "-y", str(dest)],
                    capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45,
                )
                if run.returncode != 0 or not dest.exists():
                    return ""
            _vidrush_cache[value] = dest_name
            return dest_name
        except Exception as exc:
            print(f"[remotion] Aviso: asset Vidrush no preparado ({str(exc)[:100]})", flush=True)
            return ""

    for _ev in events:
        if str(_ev.get("type") or "") not in (_VIDRUSH_MOTIONS | _IMAGE_OVERLAYS):
            continue
        _primary = _stage_vidrush_asset(str(_ev.get("image") or ""), "primary")
        if not _primary:
            # Un mecanismo sin evidencia deja de ser un mecanismo: no se permite
            # que el renderer caiga a los assets de referencia del laboratorio.
            print(f"[remotion] Aviso: {str(_ev.get('type') or '')} sin asset real; se omite", flush=True)
            _ev["type"] = "lower_third"
            _ev["image"] = ""
            _ev.pop("image2", None)
            continue
        _ev["image"] = _primary
        _secondary = _stage_vidrush_asset(str(_ev.get("image2") or ""), "secondary")
        if _secondary and _secondary != _primary:
            _ev["image2"] = _secondary
        elif str(_ev.get("type") or "") in {"vidrush_evidence_matrix", "vidrush_evidence_gallery", "circle_compare"}:
            # Una matriz/galería sin una segunda evidencia real sería un preset
            # camuflado. Se rechaza, en vez de duplicar una foto o usar material
            # del laboratorio como relleno.
            print(f"[remotion] Aviso: {str(_ev.get('type') or '')} sin segunda evidencia; se omite", flush=True)
            _ev["type"] = "lower_third"
            _ev["image"] = ""
            _ev.pop("image2", None)
        else:
            _ev.pop("image2", None)

    # 🎯 LOCALIZAR EL OBJETO DE CADA CALLOUT CON VISIÓN (2026-09-05). El usuario: "la flecha
    # apunta al marco y se habla de la puerta". MiniMax escribe motion_target_x/y a ciegas
    # (casi siempre 0.5/0.5). Aquí se extrae el frame real del montaje en el instante del
    # evento y se pregunta al modelo de visión dónde está el objeto nombrado. Si no lo ve, el
    # callout pierde la flecha (tag_label): NUNCA una flecha equivocada. MOTION_VISION_LOCATE=0
    # lo desactiva; MOTION_VISION_LOCATE_MAX acota las llamadas por vídeo.
    _locate_targets_with_vision(events, video_path, project_id)

    # QC FINAL DE MOTION, DESPUÉS DE STAGEAR EVIDENCIAS Y ANTES DE ESCRIBIR PROPS/ABRIR
    # Remotion. Así el montaje nunca recibe una composición editorial sin asset, fuera de su
    # ventana SRT o solapada con la siguiente. El JSON queda como trazabilidad del gate.
    _vidrush_qc_errors = validate_vidrush_events(events, duration, PUBLIC)
    _motion_window_errors = validate_motion_windows(events, scenes or [], duration)
    _vidrush_qc_path = RUNTIME / f"vidrush_qc_{safe_id}.json"
    try:
        _vidrush_qc_path.write_text(json.dumps({
            "ok": not (_vidrush_qc_errors or _motion_window_errors),
            "duration": duration,
            "events": len([e for e in events if str(e.get("type") or "") in _VIDRUSH_MOTIONS]),
            "motion_events": len([e for e in events if str(e.get("type") or "") not in {
                "film_burn", "section_flash", "transition"}]),
            "errors": _vidrush_qc_errors + _motion_window_errors,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass
    if _vidrush_qc_errors or _motion_window_errors:
        raise RuntimeError("QC Vidrush previo al montaje rechazado: "
                           + " | ".join((_vidrush_qc_errors + _motion_window_errors)[:8]))

    # MAPA con nubes (map_zoom): staging con CALIDAD MÁXIMA (el usuario lo exige):
    #   • map_prep.prepare_map quita MARCOS y MARCAS DE AGUA (auto-borde + margen), recorta
    #     una ventana 16:9 centrada en el target (primer plano regional si hay país+bounds) y
    #     REESCALA con Lanczos+enfoque si el mapa es flojo (nada de mapas borrosos).
    #   • Tras el recorte se REMAPEAN bounds y target y se calcula el CONTORNO GeoJSON con los
    #     bounds finales → encaja al píxel. Bandera: copia simple. Chromium no carga file:// →
    #     todo va a public/ (staticFile).
    # 🎬 VOX: procesar los recortes ANTES del bucle de mapas — la imagen del evento
    # (asset de la escena) pasa por rembg (quitar fondo) y, si voxHalftone, por el
    # halftone B/N de prensa; el PNG resultante se stagea a public/ (staticFile).
    for _ev in events:
        if str(_ev.get("type") or "") not in {"vox_scene", "vox_counter"}:
            continue
        _vi = str(_ev.get("image") or "").strip()
        _half = bool(_ev.pop("voxHalftone", str(_ev.get("type")) == "vox_scene"))
        if not _vi or _vi.startswith(("http:", "https:", "data:")):
            continue
        try:
            _ip = Path(_vi.replace("file:///", "").replace("file://", "")).resolve()
            if not _ip.exists():
                _ev["image"] = ""
                continue
            from scripts.vox_assets import vox_cutout
            _dest = f"vox_{_safe_project_id(project_id)}_{_ip.stem}{'_ht' if _half else ''}.png"
            _out = vox_cutout(str(_ip), str(PUBLIC / _dest), halftone=_half,
                              cell=int(os.environ.get("VOX_HALFTONE_CELL", "6") or 6))
            if _out:
                _ev["image"] = _dest
                print(f"[remotion] VOX recorte listo: {_dest} (halftone={_half})", flush=True)
            else:
                _ev["image"] = ""   # sin recorte → la escena vox sale tipográfica
        except Exception as _e:
            print(f"[remotion] Aviso: recorte VOX falló ({str(_e)[:100]})", flush=True)
            _ev["image"] = ""
    # Escena vox SIN recorte utilizable (asset era vídeo, archivo perdido o recorte
    # fallido) → overlay limpio sobre el metraje; un papel vacío a pantalla completa
    # tapando el b-roll es peor que no tener escena.
    for _ev in events:
        if str(_ev.get("type") or "") == "vox_scene" and not str(_ev.get("image") or "").strip():
            _ev["type"] = "lower_third"

    for _ev in events:
        if _ev.get("type") not in {"map_zoom", "cloud_map", "map_descend"}:
            continue
        # MAPA VECTORIAL resuelto (focusName/highlight presentes) → renderEvent usa <GeoMap> igual,
        # así que NO tiene sentido preparar el ráster NASA world_topo.jpg (recorte/upscale/contorno):
        # trabajo y disco desperdiciados. Se salta el staging ráster; el ráster queda de RESPALDO
        # solo cuando NINGÚN país resuelve (sin focusName/highlight → CloudMapZoom con imagen).
        # ⚠ EXCEPCIÓN (2026-07-17): si la ROTACIÓN eligió el estilo NUBES para este mapa
        # (mapStyle='clouds', decidido en build_motion_events), el ráster SÍ hace falta aunque el
        # país resuelva — es justo lo que pinta CloudMapZoom. Este `continue` era lo que dejaba el
        # estilo con nubes sin imagen y, por tanto, muerto.
        if (_ev.get("focusName") or _ev.get("highlight")) \
                and str(_ev.get("mapStyle") or "").lower() not in {"clouds", "cloud"}:
            continue
        _p = str(_ev.get("flag") or "").strip()
        if _p and not _p.startswith(("http:", "https:", "data:")):
            try:
                _ip = Path(_p.replace("file:///", "").replace("file://", "")).resolve()
                if _ip.exists():
                    _dest = f"flag_{_safe_project_id(project_id)}_{_ip.name}"
                    shutil.copy2(_ip, PUBLIC / _dest)
                    _ev["flag"] = _dest
            except Exception as _e:
                print(f"[remotion] Aviso: no pude copiar flag={_p} ({_e})", flush=True)
        _country = str(_ev.pop("country", "") or "").strip()
        _bounds = _ev.pop("mapBounds", None)
        _crop_in = _ev.pop("mapCrop", None)
        # AUTO-RESOLVE del ráster (mapa NASA + target geocodificado + bandera). Vive en
        # _map_raster_autoresolve porque build_motion_events lo necesita ANTES (los mapas que la
        # rotación manda al estilo NUBES salen ya con su ráster); aquí es idempotente.
        _country, _bounds = _map_raster_autoresolve(_ev, _country, _bounds)
        _img = str(_ev.get("image") or "").strip()
        if not _img or _img.startswith(("http:", "https:", "data:")):
            continue
        try:
            _ip = Path(_img.replace("file:///", "").replace("file://", "")).resolve()
            if not _ip.exists() and (PUBLIC / _img).exists():
                _ip = (PUBLIC / _img).resolve()   # ya estaba en public (p.ej. pruebas)
            if not _ip.exists():
                continue
            from scripts.map_prep import prepare_map, remap_bounds
            _has_b = bool(_bounds) and len(list(_bounds)) == 4
            try:
                _edge = float(_crop_in) if _crop_in is not None else (0.0 if _has_b else 0.05)
            except (TypeError, ValueError):
                _edge = 0.0 if _has_b else 0.05
            _ww = None
            if _has_b and _country:
                try:
                    from scripts.geo_outline import outline_points
                    _wp = outline_points(_country, tuple(float(x) for x in _bounds), max_points=300)
                    if _wp:
                        _xs = [q[0] for q in _wp]
                        _ww = max(0.1, min(1.0, (max(_xs) - min(_xs)) * 2.6))
                except Exception:
                    _ww = None
            _dest = f"map_{_safe_project_id(project_id)}_{_ip.stem}.jpg"
            _res = prepare_map(str(_ip), str(PUBLIC / _dest),
                               target_xy=(_as_float(_ev.get("targetX"), 0.5),
                                          _as_float(_ev.get("targetY"), 0.5)),
                               edge_crop=_edge, window_w=_ww)
            _ev["image"] = _dest
            _ev["targetX"], _ev["targetY"] = _res["target"]
            # Remapear también el DESTINO de la ruta al recorte (mismas fracciones que el target).
            _l, _t, _r, _b2 = _res["crop"]
            _rx, _ry = _as_float(_ev.get("routeToX"), -1), _as_float(_ev.get("routeToY"), -1)
            if 0 <= _rx <= 1 and 0 <= _ry <= 1:
                _ev["routeToX"] = round((_rx - _l) / max(1e-6, 1 - _l - _r), 4)
                _ev["routeToY"] = round((_ry - _t) / max(1e-6, 1 - _t - _b2), 4)
            else:
                _ev.pop("routeToX", None)
                _ev.pop("routeToY", None)
            if _has_b and _country:
                from scripts.geo_outline import outline_points
                _nb = remap_bounds(tuple(float(x) for x in _bounds), _res["crop"])
                _ev["outline"] = outline_points(_country, _nb, max_points=900)
            print(f"[remotion] Mapa preparado: {_dest} {_res['size']} "
                  f"(upscaled={_res['upscaled']}, contorno={len(_ev.get('outline') or [])} pts)", flush=True)
        except Exception as _e:
            # Fallback: copia simple (comportamiento anterior) — nunca romper el render.
            try:
                _dest = f"map_{_safe_project_id(project_id)}_{Path(_img).name}"
                shutil.copy2(_ip, PUBLIC / _dest)
                _ev["image"] = _dest
            except Exception:
                pass
            print(f"[remotion] Aviso: prep de mapa falló ({str(_e)[:120]}); copia simple", flush=True)
    props = {
        "videoSrc": source_name,
        "width": width,
        "height": height,
        "fps": fps,
        "durationSeconds": duration,
        "style": quality,
        "events": events,
    }
    props_path = RUNTIME / props_name
    props_path.write_text(json.dumps(props, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "props_path": str(props_path),
        "props_file": props_name,
        "source_file": source_name,
        "source_path": str(source_path),
        "events": len(events),
        "duration": duration,
        "width": width,
        "height": height,
        "fps": fps,
        "source_width": meta["width"],
        "source_height": meta["height"],
        "source_fps": meta["fps"],
        "vidrush_qc_path": str(_vidrush_qc_path),
    }


def apply_remotion(
    video_path: str,
    out_path: str,
    scenes: list[dict] | None = None,
    quality: str = "low",
    progress_cb=None,
    motion_level: str = "mid",
    lang: str = "es",
    motion_style_hint: str = "",
    project_id: str | None = None,
) -> str:
    def log(msg: str) -> None:
        print(_console_text(msg), flush=True)
        if progress_cb:
            progress_cb(msg)

    if not remotion_available():
        raise RuntimeError("Remotion no esta disponible")
    _ensure_runtime(log)

    src = Path(video_path).resolve()
    out = Path(out_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    lock_service = os.environ.get("PIPELINE_EXPORT_LOCK_SERVICE", "pipeline_export")
    heartbeat = None
    try:
        try:
            from scripts.profile_utils import acquire_service_lock
            # 🔓 2026-09-16 (medido): aquí se pedía el turno SIN `slots`, así que
            # acquire_service_lock usaba slots=1 y este render se quedaba SIEMPRE con el
            # turno 1 — y encima lo conserva con el latido durante TODO el render. Medido
            # hoy: puerto-rico-1918 a 2,8 escenas/h (255 escenas = ~90 h) reteniendo el
            # único turno con 12 vídeos YA MONTADOS esperando 7,7 h detrás. EXPORT_SLOTS
            # solo lo respetaba el montaje final (video_assembler); aquí, en audio_enhancer
            # y en hyperframes se ignoraba. Ahora los cuatro usan el mismo número de turnos.
            try:
                _slots = max(1, int(os.environ.get("EXPORT_SLOTS", "1") or 1))
            except (TypeError, ValueError):
                _slots = 1
            acquire_service_lock(
                lock_service,
                timeout=float(os.environ.get("REMOTION_LOCK_TIMEOUT", "7200")),
                log=log,
                slots=_slots,
            )
            heartbeat = _start_lock_heartbeat(lock_service)
        except Exception as e:
            log(f"[remotion] Aviso: no pude bloquear render unico ({e}); continuo.")

        prepared = prepare_remotion_project(
            str(src),
            scenes,
            quality,
            motion_level=motion_level,
            lang=lang,
            motion_style_hint=motion_style_hint,
            project_id=project_id or f"{out.parent.name}_{out.stem}_{os.getpid()}",
        )
        duration = float(prepared["duration"])
        props_path = Path(prepared["props_path"])

        log(
            f"[remotion] Render local: {prepared['events']} overlays / {duration:.1f}s "
            f"@ {prepared['width']}x{prepared['height']} {prepared['fps']}fps "
            f"(source {prepared['source_width']}x{prepared['source_height']} {prepared['source_fps']:.3g}fps)"
        )
        # 0 overlays (p. ej. motion_level=none elegido por el usuario) → NO tiene
        # sentido re-codificar el vídeo entero en Remotion para no pintar nada:
        # se copia el bruto tal cual y ahorramos minutos de render.
        if int(prepared.get("events") or 0) <= 0:
            log("[remotion] Sin overlays → salto el re-render (copio el vídeo tal cual)")
            shutil.copy2(str(src), str(out))
            return str(out)
        # ⚡ 2026-08-10 (usuario, DOS VECES): "los motion solo deben hacer las partes donde HAY
        # motion, no re-exportar todo el vídeo; eso traba G-Labs y los otros exports".
        # MEDIDO: vídeo de 44 min con 4 overlays → antes 2676s por Chrome; ahora 14s (0.5%),
        # el resto se copia SIN recodificar. Se activa por defecto; MOTION_SEGMENTS=0 lo apaga.
        # Documentary renders are a strict SRT/video invariant.  The stream-copy
        # concat path is excellent for long general videos, but a malformed TS
        # piece can report a valid container duration while carrying only the
        # first part of its video stream (the Sydney proof exposed exactly this).
        # Prefer one authoritative Remotion render for documentary jobs; the
        # overlays themselves are still sparse and only the planner-selected
        # windows are drawn.  An explicit opt-in can re-enable segmentation for
        # a trusted installation.
        _doc_full_render = (
            os.environ.get("PIPELINE_DOCUMENTARY", "0").strip().lower()
            in {"1", "true", "yes", "on"}
            and os.environ.get("MOTION_SEGMENTS_DOCUMENTARY", "0").strip().lower()
            not in {"1", "true", "yes", "on"}
        )
        if (not _doc_full_render
                and os.environ.get("MOTION_SEGMENTS", "1").strip().lower() not in {"0", "false", "no", "off"}
                and duration > float(os.environ.get("MOTION_SEGMENTS_MIN_DUR", "45") or 45)):
            _evs = []
            try:
                _pp = json.loads(props_path.read_text(encoding="utf-8"))
                _evs = _pp.get("events") or _pp.get("motionEvents") or []
            except Exception:  # noqa: BLE001
                _evs = []
            if _evs:
                def _render_win(_seg_src, _t0, _t1, _dst):
                    """Renderiza SOLO ese tramo con Remotion (eventos re-basados a 0)."""
                    _sub = []
                    for _e in _evs:
                        _s = float(_e.get("start", _e.get("t", 0)) or 0)
                        _d = float(_e.get("duration", _e.get("dur", 3)) or 3)
                        if _s + _d >= _t0 and _s <= _t1:
                            _e2 = dict(_e); _e2["start"] = max(0.0, _s - _t0)
                            _sub.append(_e2)
                    if not _sub:
                        return None
                    _pr = prepare_remotion_project(
                        _seg_src, scenes, quality, motion_level=motion_level, lang=lang,
                        motion_style_hint=motion_style_hint,
                        project_id=f"{project_id or out.stem}_seg{int(_t0)}")
                    try:
                        _pj = json.loads(Path(_pr["props_path"]).read_text(encoding="utf-8"))
                        _pj["events"] = _sub
                        Path(_pr["props_path"]).write_text(json.dumps(_pj, ensure_ascii=False),
                                                           encoding="utf-8")
                    except Exception:  # noqa: BLE001
                        pass
                    _rc = _remotion_cmd()
                    _c = [_rc, "render", str(ENTRY), "PipelineMotion", _dst,
                          "--props", str(_pr["props_path"]), "--log", "error"]                         + _remotion_performance_flags(motion_level or "")
                    if Path(_rc).name.startswith("npx"):
                        _c.insert(1, "remotion")
                    _r = subprocess.run(_c, cwd=str(RUNTIME), env=_env(), capture_output=True,
                                        text=True, encoding="utf-8", errors="replace",
                                        timeout=_render_timeout(_t1 - _t0) or 3600)
                    return _dst if (_r.returncode == 0 and os.path.exists(_dst)) else None

                _seg_out = render_motion_by_segments(str(src), str(out), _evs, _render_win,
                                                     fps=int(prepared.get("fps") or 30), log=log)
                if _seg_out and os.path.exists(_seg_out):
                    return str(out)
                log("[motion] render por tramos no salió → sigo con el render completo")

        remotion_cmd = _remotion_cmd()
        cmd = [
            remotion_cmd,
            "render",
            str(ENTRY),
            "PipelineMotion",
            str(out),
            "--props", str(props_path),
            "--log", "error",
        ] + _remotion_performance_flags(motion_level or "")
        if Path(remotion_cmd).name.startswith("npx"):
            cmd.insert(1, "remotion")
        log(
            "[remotion] Perf: "
            f"concurrency={os.environ.get('REMOTION_CONCURRENCY', '3')} "
            f"hw={os.environ.get('REMOTION_HW_ACCEL', 'if-possible')} "
            f"cache={os.environ.get('REMOTION_MEDIA_CACHE_GB', '16')}GB"
        )
        timeout_s = _render_timeout(duration)
        log("[remotion] Timeout max: sin limite" if timeout_s is None else f"[remotion] Timeout max: {timeout_s}s")
        try:
            r = subprocess.run(
                cmd,
                cwd=str(RUNTIME),
                env=_env(),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_s,
            )
        except subprocess.TimeoutExpired as e:
            _dump_remotion_fail(out, cmd, "TIMEOUT", timeout_s, e.stderr, e.stdout)
            tail = ((e.stderr or "") + "\n" + (e.stdout or ""))[-1600:]
            raise RuntimeError(f"Remotion timeout tras {timeout_s}s. {tail}".strip())
        if r.returncode != 0 or not out.exists():
            _dump_remotion_fail(out, cmd, r.returncode, timeout_s, r.stderr, r.stdout)
            tail = ((r.stderr or "") + "\n" + (r.stdout or ""))[-1600:].strip()
            raise RuntimeError(
                f"Remotion fallo rc={r.returncode}: {tail or 'sin salida de consola'}"
            )
    finally:
        if heartbeat:
            heartbeat.set()
        try:
            from scripts.profile_utils import release_service_lock
            release_service_lock(lock_service)
        except Exception:
            pass
    log(f"[remotion] OK -> {out.name}")
    return str(out)


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--out", required=True)
    p.add_argument("--manifest", default="")
    p.add_argument("--quality", default="low", choices=["low", "mid", "high"])
    p.add_argument("--motion-level", default="mid",
                   choices=["none", "low", "mid", "high"])
    p.add_argument("--lang", default="es")
    args = p.parse_args()

    manifest_scenes = []
    if args.manifest:
        data = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
        manifest_scenes = data.get("scenes", data if isinstance(data, list) else [])
    print(apply_remotion(
        args.video,
        args.out,
        manifest_scenes,
        args.quality,
        motion_level=args.motion_level,
        lang=args.lang,
    ))


# ═════════════════════════════════════════════════════════════════════════════════════════
# ⚡ RENDER POR TRAMOS (usuario 2026-08-10): "los motion solo deben hacer las partes donde HAY
# motion, no re-exportar todo el vídeo; eso traba G-Labs y los otros exports".
# Antes: un vídeo de 44 min con 4 overlays → 44 min re-renderizados por Chrome.
# Ahora: se renderizan SOLO las ventanas con overlay y el resto se COPIA sin recodificar
# (stream copy). En un vídeo típico eso es ~5% del metraje → ~20x menos trabajo y la CPU/GPU
# queda libre para G-Labs y para el export de otros vídeos.
# ═════════════════════════════════════════════════════════════════════════════════════════
def _motion_windows(events: list[dict], total: float, pad: float = 0.5,
                    merge_gap: float = 2.0) -> list[tuple]:
    """Ventanas [inicio,fin] que REALMENTE llevan overlay, con margen y fusionando las cercanas."""
    wins = []
    for e in events or []:
        try:
            t0 = max(0.0, float(e.get("start", e.get("t", 0)) or 0) - pad)
            d = float(e.get("duration", e.get("dur", 3.0)) or 3.0)
            t1 = min(total, t0 + d + pad * 2)
            if t1 > t0:
                wins.append((t0, t1))
        except (TypeError, ValueError):
            continue
    if not wins:
        return []
    wins.sort()
    out = [list(wins[0])]
    for a, b in wins[1:]:
        if a - out[-1][1] <= merge_gap:      # muy cerca → una sola ventana (menos cortes)
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(round(a, 3), round(b, 3)) for a, b in out]


def render_motion_by_segments(video_path: str, out_path: str, events: list[dict],
                              render_window, fps: int = 30, log=print) -> str | None:
    """Aplica el motion SOLO en las ventanas con overlay y copia el resto sin recodificar.

    `render_window(src, t0, t1, dst)` = función que renderiza ESE tramo (Remotion o ffmpeg) y
    devuelve la ruta, o None si falla (entonces se usa el tramo original sin overlay).
    Devuelve la ruta final, o None si no se pudo (el caller usa el vídeo tal cual).
    """
    total = _duration(video_path)
    wins = _motion_windows(events, total)
    if not wins:
        log("[motion] sin overlays → no hay nada que renderizar")
        return video_path
    _cover = sum(b - a for a, b in wins)
    log(f"[motion] {len(wins)} tramo(s) con overlay = {_cover:.1f}s de {total:.1f}s "
        f"({_cover / max(1, total) * 100:.0f}% del vídeo) → el resto se COPIA sin recodificar")

    work = Path(out_path).parent / f"_motionseg_{Path(out_path).stem}"
    work.mkdir(parents=True, exist_ok=True)
    piezas, cur, idx = [], 0.0, 0
    try:
        for (a, b) in wins:
            if a > cur + 0.05:                       # tramo SIN overlay → copia directa
                p = work / f"keep_{idx:03d}.ts"
                _ff_seg(video_path, cur, a, str(p), copy=True)
                if p.exists():
                    piezas.append(str(p))
                idx += 1
            seg_src = work / f"src_{idx:03d}.mp4"     # tramo CON overlay → recorte + render
            _ff_seg(video_path, a, b, str(seg_src), copy=False, fps=fps)
            rendered = None
            if seg_src.exists():
                try:
                    rendered = render_window(str(seg_src), a, b, str(work / f"ren_{idx:03d}.mp4"))
                except Exception as e:                # noqa: BLE001
                    log(f"[motion] tramo {a:.1f}-{b:.1f}s falló ({str(e)[:60]}) → sin overlay")
            use = rendered if (rendered and os.path.exists(rendered)) else str(seg_src)
            p = work / f"ov_{idx:03d}.ts"
            _ff_to_ts(use, str(p), fps=fps)
            if p.exists():
                piezas.append(str(p))
            idx += 1
            cur = b
        if cur < total - 0.05:                        # cola final sin overlay
            p = work / f"keep_{idx:03d}.ts"
            _ff_seg(video_path, cur, total, str(p), copy=True)
            if p.exists():
                piezas.append(str(p))
        if not piezas:
            return None
        # ⚠ 2026-08-10: aquí se usaba el protocolo `concat:a|b|c…` con TODAS las piezas en UNA
        # línea de comandos. Con 183 piezas (rey-salomón) eso son ~22.000 caracteres y en Windows
        # revienta el límite de línea de comandos (~32.767) → ffmpeg fallaba, se caía al render
        # COMPLETO y ese sacó un vídeo de 1,6 s que se dio por bueno. El demuxer `-f concat` lee
        # las piezas de un FICHERO, así que no hay límite por número de tramos.
        _lst = work / "_piezas.txt"
        _lst.write_text(
            "\n".join("file '" + str(p).replace("\\", "/").replace("'", "'\\''") + "'"
                      for p in piezas) + "\n", encoding="utf-8")
        r = _ff_run_simple(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                            "-i", str(_lst), "-c", "copy", "-bsf:a", "aac_adtstoasc",
                            "-movflags", "+faststart", out_path])
        if r != 0 or not os.path.exists(out_path):
            log(f"[motion] concat de {len(piezas)} tramos falló (ffmpeg={r}) → devuelvo el original")
            return None
        # el concat puede "salir bien" y dejar un vídeo truncado: se comprueba la duración
        _got = _duration(out_path)
        if _got < total * 0.95:
            log(f"[motion] concat salió corto ({_got:.0f}s de {total:.0f}s) → NO lo doy por bueno")
            return None
        log(f"[motion] ✓ montado por tramos ({len(piezas)} piezas) → {os.path.basename(out_path)}")
        return out_path
    finally:
        if os.environ.get("MOTION_KEEP_TMP", "0") != "1":
            import shutil as _sh
            _sh.rmtree(work, ignore_errors=True)


def _ff_run_simple(cmd, timeout=3600) -> int:
    cf = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) if os.name == "nt" else 0
    if os.name == "nt":
        cf |= 0x4000                      # BelowNormal: no ahogar al navegador
    try:
        return subprocess.run(cmd, capture_output=True, timeout=timeout, creationflags=cf).returncode
    except Exception:
        return 1


def _ff_seg(src: str, t0: float, t1: float, dst: str, copy: bool = True, fps: int = 30) -> None:
    """Recorta [t0,t1]. copy=True → SIN recodificar (rapidísimo, para los tramos sin overlay).

    🐛 2026-08-23 — EL BUG DE LA VOZ QUE REPETIA PALABRAS.
    El usuario: «se repiten palabras, es como "fuera hace 50 grados de calor. 50 grados
    de calor"… y cuando aparece un motion graphic se cambia la voz». Transcribiendo el
    video final se ve exacto:
        32.6-38.6  …supera los 50 grados en vera[no]
        38.6-43.5  en verano la caliza refleja la luz…
    «en verano» suena DOS VECES. La causa esta aqui: con `-c copy` ffmpeg solo puede
    cortar en FOTOGRAMA CLAVE, asi que el tramo copiado arranca ANTES de t0 (en el
    keyframe anterior) y repite el audio que el tramo previo ya traia. Y como los tramos
    con overlay SI se recodifican (corte exacto), la costura se nota justo donde entra
    el rotulo — de ahi que pareciera que "cambia la voz".
    La unica forma de cortar EXACTO es recodificar. Se pierde algo de velocidad, pero un
    video con palabras repetidas no sirve. MOTION_SEG_COPY=1 devuelve el modo rapido.
    """
    if copy and os.environ.get("MOTION_SEG_COPY", "0").strip().lower() not in {"1", "true", "yes"}:
        copy = False
    if copy:
        _ff_run_simple(["ffmpeg", "-y", "-v", "error", "-ss", f"{t0:.3f}", "-to", f"{t1:.3f}",
                        "-i", src, "-c", "copy", "-bsf:v", "h264_mp4toannexb", "-f", "mpegts", dst])
    else:
        _ff_run_simple(["ffmpeg", "-y", "-v", "error", "-ss", f"{t0:.3f}", "-to", f"{t1:.3f}",
                        "-i", src, "-c:v", "libx264", "-preset", "fast", "-crf",
                        os.environ.get("EXPORT_CRF", "23"), "-pix_fmt", "yuv420p",
                        "-r", str(int(fps)), "-fps_mode", "cfr", "-c:a", "aac", "-b:a", "192k",
                        "-ar", "48000", "-ac", "2", dst])


def _ff_to_ts(src: str, dst: str, fps: int = 30) -> None:
    _ff_run_simple(["ffmpeg", "-y", "-v", "error", "-i", src,
                    "-c:v", "libx264", "-preset", "fast", "-crf", os.environ.get("EXPORT_CRF", "23"),
                    "-pix_fmt", "yuv420p", "-r", str(int(fps)), "-fps_mode", "cfr",
                    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                    "-bsf:v", "h264_mp4toannexb", "-f", "mpegts", dst])
