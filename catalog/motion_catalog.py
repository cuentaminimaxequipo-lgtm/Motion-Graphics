"""
motion_catalog.py — CATÁLOGO ÚNICO de plantillas de motion graphics documental.

Es la fuente de verdad para: (a) el prompt del agente especialista que manda a MiniMax,
(b) la validación del plan, (c) los toggles por canal en la UI, (d) el showcase.

⚠ 2026-09-06 — El usuario: "haz como un especialista, un agente que sea experto en los motion
graphics; que se detallen los ~39 tipos con ejemplos, cuándo se pueden poner y cuándo no… y que
se pueda configurar por canal: por defecto todos activados y lo planifica MiniMax, pero si en un
canal solo quiero textos simples, puedo activarlo y desactivarlo".

Cada entrada declara:
  key        identificador que viaja en `motion`
  group      familia para los toggles de la UI
  screen     'full'  = tapa el metraje (composición)
             'over'  = overlay sobre el metraje
  needs      requisitos duros; si no se cumplen el saneador la degrada
  when       CUÁNDO usarla (una frase, para el prompt)
  avoid      CUÁNDO NO usarla
  fields     qué campos rellenar y con qué contenido
  example    ejemplo real en español, con el texto de narración que lo justificaría
"""
from __future__ import annotations

# needs: campos que el planner DEBE aportar; 'photo' = la escena tiene asset de imagen/clip
CATALOG: list[dict] = [
    # ── CIFRAS Y RANKING ──────────────────────────────────────────────────────
    {
        "key": "stat_big", "group": "cifras", "screen": "over", "needs": ["digit"],
        "when": "La narración DICE una cifra con dígitos y esa cifra es el dato de la escena.",
        "avoid": "Conceptos sin número ('el telar', 'trueque'). Si el número está en letra, escríbelo en dígitos.",
        "fields": "motion_title = la cifra con unidad. motion_subtitle = qué mide, 3-8 palabras EN MAYÚSCULAS.",
        "example": {"narracion": "sobreviven 12 pueblos donde el tiempo se quedó quieto",
                     "motion_title": "12", "motion_subtitle": "PUEBLOS DONDE EL TIEMPO SE DETUVO"},
    },
    {
        "key": "rank_badge", "group": "cifras", "screen": "over", "needs": ["digit"],
        "when": "Elemento de un ranking/lista numerada. Es la forma PREFERIDA de marcar el puesto.",
        "avoid": "Si no hay lista numerada en el guion.",
        "fields": "motion_title = solo el número en dígitos. motion_subtitle = nombre del elemento.",
        "example": {"narracion": "el número once es Covadonga, en Atlixco",
                     "motion_title": "11", "motion_subtitle": "COVADONGA, ATLIXCO"},
    },
    {
        "key": "chart", "group": "cifras", "screen": "over", "needs": ["items2"],
        "when": "La narración compara dos o más cantidades reales de la misma magnitud y la relación se entiende mejor visualmente.",
        "avoid": "Sin dos valores comparables, con datos aproximados o si la barra puede sugerir una escala no dicha.",
        "fields": "motion_title = conclusión de 2-6 palabras. motion_items = ['Etiqueta: valor', 'Etiqueta: valor'] con unidades literales del guion.",
        "example": {"narracion": "la torre mide 300 metros y la anterior 250",
                     "motion_title": "50 METROS MÁS", "motion_items": ["Nueva: 300 m", "Anterior: 250 m"]},
    },
    {
        "key": "structure_compare", "group": "cifras", "screen": "full", "needs": ["items2"],
        "when": "Compara dos estructuras, edificios o sistemas con una misma magnitud real: altura, plantas, coste o superficie.",
        "avoid": "Si las unidades no son comparables o si falta uno de los dos valores. No dibujes una escala que el guion no respalda.",
        "fields": "motion_title = conclusión breve. motion_items = ['Estructura A: valor unidad', 'Estructura B: valor unidad'].",
        "example": {"narracion": "el Empire State mide 381 metros y las torres llegaron a 415",
                     "motion_title": "LAS MÁS ALTAS", "motion_items": ["Empire State: 381 m", "Torres Gemelas: 415 m"]},
    },
    {
        "key": "glitch_number", "group": "cifras", "screen": "over", "needs": [],
        "when": "Cifra, año o palabra MUY corta que marca un golpe seco ('sin luz', '1965').",
        "avoid": "Textos de más de 12 caracteres.",
        "fields": "motion_title ≤12 caracteres. motion_subtitle 2-6 palabras.",
        "example": {"narracion": "y en 1965 se apagó el último telar",
                     "motion_title": "1965", "motion_subtitle": "EL ÚLTIMO TELAR"},
    },
    # ── FECHAS ────────────────────────────────────────────────────────────────
    {
        "key": "date_stamp", "group": "fechas", "screen": "over", "needs": [],
        "when": "Fecha de paso que sitúa la escena, sin detener el relato.",
        "avoid": "Si la fecha es el eje del bloque entero (usa vidrush_archive_date).",
        "fields": "motion_title = la fecha. motion_subtitle = qué pasó, 3-6 palabras.",
        "example": {"narracion": "para julio de 1962 ya casi nadie quedaba",
                     "motion_title": "Julio de 1962", "motion_subtitle": "EL ÚLTIMO TURNO"},
    },
    {
        "key": "year_dot", "group": "fechas", "screen": "over", "needs": [],
        "when": "Un año concreto marcado sobre una línea fina. Más discreto que date_stamp.",
        "avoid": "Si ya hay otra fecha en pantalla en los 15 s anteriores.",
        "fields": "motion_title = el año. motion_subtitle opcional 2-5 palabras.",
        "example": {"narracion": "cien años después la fábrica sigue en pie",
                     "motion_title": "2026", "motion_subtitle": "Cien años después"},
    },
    {
        "key": "year_timeline", "group": "fechas", "screen": "over", "needs": ["items3"],
        "when": "La narración recorre 3-5 fechas seguidas del mismo hilo (fundación→auge→cierre).",
        "avoid": "Con menos de 3 fechas reales dichas en el guion.",
        "fields": "motion_items = ['1890: Fundación', '1920: Auge textil', '1965: Cierre'].",
        "example": {"narracion": "abrió en 1890, vivió su auge en 1920 y cerró en 1965",
                     "motion_items": ["1890: Fundación", "1920: Auge textil", "1965: Cierre"]},
    },
    {
        "key": "vidrush_archive_date", "group": "fechas", "screen": "full", "needs": ["photo"],
        "when": "Fecha que ABRE un bloque histórico, sobre foto de época. Momento de peso.",
        "avoid": "Fechas de paso. Máximo 1 cada 8-10 escenas.",
        "fields": "motion_title = la fecha grande. motion_subtitle = contexto, 3-6 palabras.",
        "example": {"narracion": "todo empezó a finales del porfiriato, allá por 1890",
                     "motion_title": "1890", "motion_subtitle": "FINALES DEL PORFIRIATO"},
    },
    # ── TÍTULOS Y BLOQUES ─────────────────────────────────────────────────────
    {
        "key": "caption_bar", "group": "titulos", "screen": "over", "needs": [],
        "when": "La narración presenta un pueblo/tema NUEVO por su nombre. Formato PREFERIDO de capítulo.",
        "avoid": "Rótulos de género o estructura ('DOCUMENTAL', 'Bloque 1', 'Introducción').",
        "fields": "motion_title = el nombre propio. motion_kicker = 'Número 11' si hay ranking.",
        "example": {"narracion": "el número once es Metepec, en Atlixco",
                     "motion_title": "METEPEC", "motion_kicker": "Número 11"},
    },
    {
        "key": "echo_title", "group": "titulos", "screen": "over", "needs": [],
        "when": "Título de capítulo en registro de CRÓNICA o true-crime (estilo American Secrets).",
        "avoid": "Documentales de lugares, historia local o naturaleza: ahí va caption_bar.",
        "fields": "motion_title 2-6 palabras.",
        "example": {"narracion": "y entonces alguien reescribió el expediente",
                     "motion_title": "El documento que cambió todo"},
    },
    {
        "key": "title_kicker", "group": "titulos", "screen": "over", "needs": [],
        "when": "Giro narrativo con antecedente: una frase corta en cursiva + un título breve.",
        "avoid": "Como rótulo informativo (para eso, lower_third).",
        "fields": "motion_kicker = la frase de contexto. motion_title = 1-3 palabras.",
        "example": {"narracion": "de Puebla a Veracruz llegó aquella llamada",
                     "motion_kicker": "De Puebla a Veracruz", "motion_title": "La llamada"},
    },
    {
        "key": "stamp_word", "group": "titulos", "screen": "over", "needs": [],
        "when": "UNA palabra que es el golpe dramático del momento ('CERRADA', 'OLVIDO').",
        "avoid": "Más de 2 por vídeo. Nunca para información neutra.",
        "fields": "motion_title = la palabra. motion_subtitle opcional 3-6 palabras.",
        "example": {"narracion": "y en marzo de 1965 la fábrica cerró para siempre",
                     "motion_title": "CERRADA", "motion_subtitle": "Marzo de 1965"},
    },
    # ── TEXTO NARRATIVO ───────────────────────────────────────────────────────
    {
        "key": "narrative_text", "group": "texto", "screen": "over", "needs": ["highlight"],
        "when": "Afirmación que resume una idea (tesis, giro, contraste) y tiene una palabra con peso.",
        "avoid": "Frases descriptivas sin tesis. El resaltado NUNCA es el sujeto ni un artículo: "
                 "es el verbo o el sustantivo que carga el sentido.",
        "fields": "motion_title = la frase (6-16 palabras). motion_items = 1-3 palabras que "
                  "aparecen LITERALMENTE en motion_title.",
        "example": {"narracion": "el pueblo obrero no murió, simplemente se quedó dormido",
                     "motion_title": "El pueblo obrero no murió, se quedó dormido",
                     "motion_items": ["no murió", "dormido"]},
    },
    {
        "key": "kinetic_words", "group": "texto", "screen": "over", "needs": ["items3"],
        "when": "MUY RARO (máximo 1 por vídeo). Solo si cada trozo se sostiene SOLO y juntos forman "
                "una frase con sentido al leerlos en orden.",
        "avoid": "NUNCA para trocear una enumeración ni una frase larga. Ejemplo REAL de mal uso que "
                 "hay que evitar: 'PADRE / EN LAS MÁQUINAS / MADRE / EN EL HILADO' — leído suelto no "
                 "significa nada. Para enumerar usa topic_list; para una afirmación, narrative_text.",
        "fields": "motion_items = 3-4 trozos, cada uno una unidad con sentido propio.",
        "example": {"narracion": "ni dinero, ni bancos, ni papeles: solo la palabra",
                     "motion_items": ["Ni dinero", "Ni bancos", "Ni papeles", "Solo la palabra"]},
    },
    {
        "key": "quote_card", "group": "texto", "screen": "over", "needs": ["source"],
        "when": "Afirmación ATRIBUIDA a una fuente concreta que el guion nombra.",
        "avoid": "Sin fuente real. No inventes atribuciones.",
        "fields": "motion_title = titular 3-8 palabras. motion_subtitle = la frase 10-25 palabras. "
                  "motion_kicker = la fuente.",
        "example": {"narracion": "como decía una crónica de Metepec, era un mundo chiquito y cerrado",
                     "motion_title": "Un mundo chiquito", "motion_subtitle": "Duro para el cuerpo pero cálido para el alma",
                     "motion_kicker": "Crónica oral de Metepec"},
    },
    {
        "key": "quote_line", "group": "texto", "screen": "over", "needs": ["source"],
        "when": "Cita textual breve de un testimonio, a máquina de escribir, abajo.",
        "avoid": "Sin comillas reales en el guion.",
        "fields": "motion_title = la cita ≤120 caracteres. motion_kicker = quién lo dijo.",
        "example": {"narracion": "don Rafael lo recuerda así: aquí se trabajaba de sol a sol",
                     "motion_title": "Aquí se trabajaba de sol a sol", "motion_kicker": "Don Rafael"},
    },
    {
        "key": "ticker_word", "group": "texto", "screen": "full", "needs": [],
        "when": "Titular de prensa o veredicto que se desliza en rojo sobre negro.",
        "avoid": "Más de 1 por vídeo. Nunca para descripción.",
        "fields": "motion_title = 3-7 palabras.",
        "example": {"narracion": "el juzgado ordenó el cierre definitivo",
                     "motion_title": "Cerrada por orden judicial"},
    },
    # ── ETIQUETAS ─────────────────────────────────────────────────────────────
    {
        "key": "lower_third", "group": "etiquetas", "screen": "over", "needs": [],
        "when": "Nombre de lugar/persona/objeto cuando ningún otro tipo encaja. ÚLTIMO recurso.",
        "avoid": "Como comodín. Si lo usas más de 6 veces en 90 escenas, algo va mal.",
        "fields": "motion_title 2-5 palabras. motion_subtitle opcional 3-8 palabras.",
        "example": {"narracion": "la tienda de raya era el corazón del pueblo",
                     "motion_title": "TIENDA DE RAYA", "motion_subtitle": "Maíz, jabón y día de pago"},
    },
    {
        "key": "center_label", "group": "etiquetas", "screen": "over", "needs": [],
        "when": "Nombrar discretamente lo que se ve, centrado abajo, sin invadir.",
        "avoid": "Si el dato merece protagonismo.",
        "fields": "motion_title 2-4 palabras. motion_subtitle 1-3 palabras.",
        "example": {"narracion": "seguimos por el valle templado de Atlixco",
                     "motion_title": "ATLIXCO, PUEBLA", "motion_subtitle": "VALLE TEMPLADO"},
    },
    {
        "key": "tag_label", "group": "etiquetas", "screen": "over", "needs": [],
        "when": "Nombrar algo del plano SIN señalar un punto concreto.",
        "avoid": "Si puedes señalar el objeto: usa callout_label.",
        "fields": "motion_title 1-4 palabras.",
        "example": {"narracion": "aún se ve la chimenea de ladrillo",
                     "motion_title": "CHIMENEA DE LADRILLO"},
    },
    {
        "key": "callout_label", "group": "etiquetas", "screen": "over", "needs": ["target"],
        "when": "Señalar con una línea un objeto CONCRETO Y VISIBLE en el plano.",
        "avoid": "Si el objeto no está en el plano. Un modelo de visión lo comprueba y, si no lo "
                 "encuentra, la etiqueta se queda sin flecha.",
        "fields": "motion_title 1-4 palabras = el objeto tal cual se ve. motion_target_x/y (0..1).",
        "example": {"narracion": "fíjate en la puerta original de los tejedores",
                     "motion_title": "PUERTA ORIGINAL", "motion_target_x": 0.62, "motion_target_y": 0.48},
    },
    {
        "key": "label_pair", "group": "etiquetas", "screen": "over", "needs": ["items2"],
        "when": "Contraste de dos términos que el guion enfrenta.",
        "avoid": "Si no hay dos términos claros.",
        "fields": "motion_items = [A, B], 2-4 palabras cada uno.",
        "example": {"narracion": "aquí no había dinero: trueque y palabra de honor",
                     "motion_items": ["TRUEQUE", "PALABRA DE HONOR"]},
    },
    {
        "key": "frame_box", "group": "etiquetas", "screen": "over", "needs": ["target"],
        "when": "Encuadrar una ZONA del plano con un recuadro y etiquetarla.",
        "avoid": "Si la zona ocupa casi todo el encuadre.",
        "fields": "motion_title 1-4 palabras. motion_target_x/y de la zona.",
        "example": {"narracion": "mira el cerrojo, sigue siendo el original",
                     "motion_title": "CERROJO ORIGINAL", "motion_target_x": 0.5, "motion_target_y": 0.47},
    },
    # ── LISTAS Y ESQUEMAS ─────────────────────────────────────────────────────
    {
        "key": "topic_list", "group": "esquemas", "screen": "over", "needs": ["items2"],
        "when": "La narración ENUMERA 2-4 cosas seguidas.",
        "avoid": "Si solo menciona una.",
        "fields": "motion_title = cabecera 1-3 palabras. motion_items = los puntos, 2-6 palabras.",
        "example": {"narracion": "en el mercado hay fruta de temporada, dulces cristalizados y pan de la región",
                     "motion_title": "EN EL MERCADO",
                     "motion_items": ["Fruta de temporada", "Dulces cristalizados", "Pan de la región"]},
    },
    {
        "key": "parts_diagram", "group": "esquemas", "screen": "full", "needs": ["photo", "items2"],
        "when": "El asset muestra UN objeto con partes reconocibles y el guion las nombra.",
        "avoid": "Si el asset es un paisaje, una multitud o un retrato. La visión sitúa cada pieza; "
                 "las que no encuentre se descartan y con menos de 2 la composición se cae.",
        "fields": "motion_items = nombres de las piezas VISIBLES, 1-3 palabras.",
        "example": {"narracion": "el canal de piedra llevaba el agua hasta la rueda hidráulica",
                     "motion_title": "La fuerza del agua",
                     "motion_items": ["Canal de piedra", "Caudal", "Rueda"]},
    },
    {
        "key": "vidrush_cross_section", "group": "esquemas", "screen": "full", "needs": [],
        "when": "Mecanismo físico, terreno o infraestructura que hay que EXPLICAR en corte.",
        "avoid": "Como decoración. Solo si el guion explica un funcionamiento.",
        "fields": "motion_title = la conclusión. motion_items = [etiqueta arriba, etiqueta abajo].",
        "example": {"narracion": "el agua bajaba por el canal y movía la rueda del molino",
                     "motion_title": "El agua movía todo el pueblo",
                     "motion_items": ["CANAL ALTO", "RUEDA DEL MOLINO"]},
    },
    {
        "key": "engineering_schematic", "group": "esquemas", "screen": "full", "needs": [],
        "when": "La voz explica cómo está construido algo: planta, alzado, sección de columna/fachada, núcleo, cimentación o gatos hidráulicos.",
        "avoid": "Si solo se describe el edificio sin explicar su mecanismo o sus partes. No inventes cotas ni piezas.",
        "fields": "motion_title = idea/conclusión. motion_schematic_kind = tower_compare|floor_plan|column_section|facade_section|foundation_section|jacking_sequence. motion_items = 2-5 partes visibles.",
        "example": {"narracion": "el núcleo central soportaba el resto de la planta y los ascensores bajaban por él",
                     "motion_title": "EL NÚCLEO CARGA EL RESTO", "motion_schematic_kind": "floor_plan",
                     "motion_items": ["Núcleo central", "Ascensores", "Planta libre"]},
    },
    {
        "key": "site_plan", "group": "mapas", "screen": "full", "needs": ["items2"],
        "when": "La narración explica dónde se implanta una obra dentro de una ciudad, río, solar, barrio o conjunto de manzanas.",
        "avoid": "Para presentar un país o una ruta entre ciudades: usa map_zoom o map_route. No uses un plano de solar sin límites o etiquetas reales.",
        "fields": "motion_title = conclusión del solar. motion_schematic_kind = site_plan. motion_items = 2-5 etiquetas reales del plano (río, lado, solar, calles, manzanas).",
        "example": {"narracion": "el solar ocupaba trece manzanas en el lado oeste, junto al Hudson",
                     "motion_title": "EL SOLAR ELEGIDO", "motion_schematic_kind": "site_plan",
                     "motion_items": ["13 manzanas", "Lado oeste", "Río Hudson"]},
    },
    {
        "key": "process_flow", "group": "esquemas", "screen": "full", "needs": ["items3"],
        "when": "La narración describe una secuencia causal o de construcción de 3-5 pasos que debe leerse en orden.",
        "avoid": "Si solo hay una lista sin orden o si los pasos no aparecen en la voz.",
        "fields": "motion_title = resultado. motion_items = pasos en orden, 2-6 palabras cada uno.",
        "example": {"narracion": "primero se excava, luego se colocan los apoyos y finalmente se levanta la torre",
                     "motion_title": "DE LA EXCAVACIÓN A LA TORRE",
                     "motion_items": ["Excavar", "Colocar apoyos", "Levantar la torre"]},
    },
    {
        "key": "timeline", "group": "fechas", "screen": "full", "needs": ["items3"],
        "when": "La explicación encadena 3-5 hitos de diseño, litigio, construcción, apertura o cambio de criterio.",
        "avoid": "Con un único año o con fechas que no pertenecen al mismo proceso.",
        "fields": "motion_title = conclusión. motion_items = ['1962: ...', '1963: ...', '1964: ...'].",
        "example": {"narracion": "en 1962 ganaron los comerciantes, en 1963 cambió el criterio y en 1964 arrancó la obra",
                     "motion_title": "LA BATALLA JUDICIAL", "motion_items": ["1962: Ganan los comerciantes", "1963: Cambia el criterio", "1964: Arranca la obra"]},
    },
    {
        "key": "pyramid", "group": "esquemas", "screen": "full", "needs": ["items2"],
        "when": "La narración explica niveles jerárquicos reales: cargas, responsabilidades, capas de un sistema o rangos.",
        "avoid": "No usar para cualquier lista ni para la pirámide física de un edificio si no hay niveles explicados.",
        "fields": "motion_title = conclusión. motion_items = niveles de arriba abajo, 2-5 etiquetas reales.",
        "example": {"narracion": "la carga baja del techo a las vigas, de las vigas a las columnas y de las columnas al suelo",
                     "motion_title": "CÓMO BAJA LA CARGA", "motion_items": ["Techo", "Vigas", "Columnas", "Cimentación"]},
    },
    {
        "key": "map_route", "group": "mapas", "screen": "full", "needs": ["items2"],
        "when": "La voz describe un desplazamiento, expansión, conexión o ruta entre dos lugares concretos.",
        "avoid": "Si solo se presenta un punto o un solar urbano: usa map_zoom o site_plan.",
        "fields": "motion_title = propósito de la ruta. motion_items = [origen, destino] con nombres reales.",
        "example": {"narracion": "el material viajaba desde Nueva Jersey hasta el solar de Manhattan",
                     "motion_title": "LA RUTA DEL MATERIAL", "motion_items": ["Nueva Jersey", "Manhattan"]},
    },
    # ── EVIDENCIA Y DOCUMENTOS ────────────────────────────────────────────────
    {
        "key": "vidrush_evidence_matrix", "group": "evidencia", "screen": "full", "needs": ["photo", "photo2"],
        "when": "DOS evidencias visuales distintas que hay que comparar o conectar.",
        "avoid": "Sin segunda foto real. Nunca dupliques la misma.",
        "fields": "motion_title = la conclusión. motion_kicker / motion_subtitle = etiqueta de cada foto.",
        "example": {"narracion": "el mismo telar en 1920 y hoy, abandonado",
                     "motion_title": "Dos épocas, un mismo telar",
                     "motion_kicker": "1920", "motion_subtitle": "HOY"},
    },
    {
        "key": "vidrush_evidence_gallery", "group": "evidencia", "screen": "full", "needs": ["photo", "photo2"],
        "when": "2-3 fotos relacionadas que juntas cuentan algo.",
        "avoid": "Sin al menos dos fotos reales distintas.",
        "fields": "motion_title = la conclusión. motion_items = pie de cada foto.",
        "example": {"narracion": "casas obreras, capilla y tienda de raya: un pueblo entero",
                     "motion_title": "Un pueblo entero",
                     "motion_items": ["Casas obreras", "Capilla", "Tienda de raya"]},
    },
    {
        "key": "vidrush_dossier_compare", "group": "evidencia", "screen": "full", "needs": ["photo"],
        "when": "Dos VERSIONES de un documento o dos relatos enfrentados.",
        "avoid": "Si no hay documento ni versiones.",
        "fields": "motion_items = [texto del doc 1, texto del doc 2]. motion_title = la conclusión.",
        "example": {"narracion": "el acta decía una cosa; la versión corregida, otra",
                     "motion_title": "Alguien reescribió la historia",
                     "motion_items": ["La versión que quedó en el registro", "La versión que lo cambió todo"]},
    },
    {
        "key": "doc_highlight", "group": "evidencia", "screen": "full", "needs": ["photo", "target"],
        "when": "El asset ES un documento o texto y hay que subrayar una línea.",
        "avoid": "Si el asset no es un documento legible.",
        "fields": "motion_title = pie. motion_target_x/y de la línea.",
        "example": {"narracion": "en el acta de cierre aparece la fecha exacta",
                     "motion_title": "Acta de cierre, 1965", "motion_target_x": 0.5, "motion_target_y": 0.42},
    },
    {
        "key": "photo_strip", "group": "evidencia", "screen": "full", "needs": ["photo"],
        "when": "Enumerar 2-3 lugares/objetos del mismo conjunto, con número.",
        "avoid": "Si no hay conjunto real.",
        "fields": "motion_items = pie de cada foto, 1-3 palabras. rank = número inicial.",
        "example": {"narracion": "empezamos por Metepec, seguimos a Covadonga y cerramos en Atlixco",
                     "motion_items": ["Metepec", "Covadonga", "Atlixco"]},
    },
    {
        "key": "circle_compare", "group": "evidencia", "screen": "full", "needs": ["photo", "photo2"],
        "when": "Antes/después con dos imágenes reales.",
        "avoid": "Sin dos fotos distintas.",
        "fields": "motion_items = [etiqueta A, etiqueta B]. motion_title = la conclusión.",
        "example": {"narracion": "así se veía en 1993 y así está hoy",
                     "motion_items": ["1993", "HOY"], "motion_title": "Treinta años después"},
    },
    # ── PERSONAS ──────────────────────────────────────────────────────────────
    {
        "key": "vidrush_identity_cutout", "group": "personas", "screen": "full", "needs": ["photo"],
        "when": "Se PRESENTA una persona nueva y el asset la muestra.",
        "avoid": "Si la foto no es de esa persona. Nunca sobre un paisaje.",
        "fields": "motion_title = el nombre. motion_subtitle = quién es. motion_items[0] = rol/época.",
        "example": {"narracion": "Harold y Helen Kite fundaron aquella fábrica en 1921",
                     "motion_title": "HAROLD Y HELEN KITE", "motion_subtitle": "Fundadores de la fábrica, 1921",
                     "motion_items": ["SOCIOS FUNDADORES"]},
    },
    {
        "key": "vidrush_field_profile", "group": "personas", "screen": "full", "needs": ["photo", "items2"],
        "when": "Ficha técnica de una persona, lugar u objeto con 2-3 datos que el guion da.",
        "avoid": "Sin datos reales que listar.",
        "fields": "motion_title = el sujeto. motion_subtitle = qué es. motion_items = 2-3 datos.",
        "example": {"narracion": "la fábrica de Metepec hilaba y tejía, tenía su propio caserío obrero y cerró en los sesenta",
                     "motion_title": "FÁBRICA METEPEC", "motion_subtitle": "HILADOS Y TEJIDOS · ATLIXCO",
                     "motion_items": ["Una de las más grandes del estado", "Caserío obrero alrededor", "Cerrada en los años 60"]},
    },
    {
        "key": "subject_profile", "group": "personas", "screen": "full", "needs": ["photo", "items2"],
        "when": "Protagonista con sus rasgos, foto a un lado y características al otro.",
        "avoid": "Si no hay retrato ni características.",
        "fields": "motion_title = nombre. motion_subtitle = rol. motion_items = 2-4 rasgos.",
        "example": {"narracion": "llegaron sin capital, abrieron dieciséis locales y cerraron en 1972",
                     "motion_title": "Harold y Helen Kite", "motion_subtitle": "Fundadores · 1921",
                     "motion_items": ["Llegaron sin capital", "Abrieron 16 locales", "Cerraron en 1972"]},
    },
    {
        "key": "vidrush_inspector_lens", "group": "personas", "screen": "full", "needs": ["photo", "target"],
        "when": "Una lente viaja hasta un DETALLE del objeto que la narración resalta.",
        "avoid": "Si no puedes nombrar el detalle exacto.",
        "fields": "motion_title = el detalle. motion_target_x/y OBLIGATORIOS.",
        "example": {"narracion": "mira la madera de la puerta, sigue siendo la original",
                     "motion_title": "PUERTA ORIGINAL", "motion_target_x": 0.62, "motion_target_y": 0.48},
    },
    # ── FOTO SOLA ─────────────────────────────────────────────────────────────
    {
        "key": "photo_inset", "group": "foto", "screen": "over", "needs": ["photo"],
        "when": "Insertar una foto pequeña sobre el metraje, con pie.",
        "avoid": "Si la foto merece pantalla completa.",
        "fields": "motion_title = pie, 3-8 palabras.",
        "example": {"narracion": "aquella máquina vino de Inglaterra",
                     "motion_title": "Telar inglés de 1920"},
    },
    {
        "key": "photo_caption", "group": "foto", "screen": "full", "needs": ["photo"],
        "when": "Una foto de archivo que merece una pausa, centrada sobre negro.",
        "avoid": "Con clips de vídeo. Solo fotos.",
        "fields": "motion_title = pie 2-5 palabras.",
        "example": {"narracion": "esta es la única foto que queda del caserío",
                     "motion_title": "EL CASERÍO OBRERO"},
    },
    # ── RESPIRO ───────────────────────────────────────────────────────────────
    {
        "key": "none", "group": "respiro", "screen": "over", "needs": [],
        "when": "El plano habla solo. 15-20% de las escenas.",
        "avoid": "Más de 2 seguidas.",
        "fields": "—",
        "example": {"narracion": "(el b-roll respira)"},
    },
]

BY_KEY = {e["key"]: e for e in CATALOG}
ALL_KEYS = [e["key"] for e in CATALOG if e["key"] != "none"]
GROUPS: dict[str, list[str]] = {}
for _e in CATALOG:
    GROUPS.setdefault(_e["group"], []).append(_e["key"])
FULLSCREEN = {e["key"] for e in CATALOG if e["screen"] == "full"}
NEEDS_PHOTO = {e["key"] for e in CATALOG if "photo" in e["needs"]}
NEEDS_SECOND_PHOTO = {e["key"] for e in CATALOG if "photo2" in e["needs"]}
NEEDS_TARGET = {e["key"] for e in CATALOG if "target" in e["needs"]}
NEEDS_DIGIT = {e["key"] for e in CATALOG if "digit" in e["needs"]}


# Etiquetas para los toggles del panel (una por plantilla) y nombre de cada grupo.
LABELS: dict[str, str] = {
    "stat_big": "Cifra grande centrada", "rank_badge": "Badge de ranking (#N)",
    "glitch_number": "Cifra con glitch",
    "date_stamp": "Sello de fecha (esquina)", "year_dot": "Año sobre línea",
    "year_timeline": "Línea de tiempo (3-5 hitos)", "vidrush_archive_date": "Fecha de archivo (pantalla)",
    "caption_bar": "Barra de capítulo", "echo_title": "Título con eco",
    "title_kicker": "Kicker + título", "stamp_word": "Palabra gigante",
    "narrative_text": "Frase con palabras resaltadas", "kinetic_words": "Frase en trozos",
    "quote_card": "Tarjeta de cita", "quote_line": "Cita a máquina", "ticker_word": "Titular deslizante",
    "lower_third": "Rótulo de papel", "center_label": "Etiqueta centrada",
    "tag_label": "Etiqueta sin flecha", "callout_label": "Etiqueta con flecha",
    "label_pair": "Par de etiquetas", "frame_box": "Recuadro sobre zona",
    "topic_list": "Lista de puntos", "parts_diagram": "Diagrama de piezas",
    "vidrush_cross_section": "Corte transversal",
    "vidrush_evidence_matrix": "Dos evidencias", "vidrush_evidence_gallery": "Galería de fotos",
    "vidrush_dossier_compare": "Dos documentos", "doc_highlight": "Documento subrayado",
    "photo_strip": "Tira de fotos numeradas", "circle_compare": "Antes/después en círculos",
    "vidrush_identity_cutout": "Presentación de persona", "vidrush_field_profile": "Ficha técnica",
    "subject_profile": "Perfil con características", "vidrush_inspector_lens": "Lupa sobre detalle",
    "photo_inset": "Foto insertada", "photo_caption": "Foto con pie (pantalla)",
}
GROUP_LABELS: dict[str, str] = {
    "cifras": "Cifras y ranking", "fechas": "Fechas", "titulos": "Títulos y bloques",
    "texto": "Texto narrativo", "etiquetas": "Etiquetas", "esquemas": "Listas y esquemas",
    "evidencia": "Evidencia y documentos", "personas": "Personas y fichas",
    "foto": "Foto sola", "respiro": "Respiro",
}


def catalog_for_ui() -> list[dict]:
    """Grupos con sus plantillas para los toggles del panel de canal."""
    out = []
    for g, keys in GROUPS.items():
        if g == "respiro":
            continue
        out.append({
            "group": g,
            "label": GROUP_LABELS.get(g, g),
            "items": [{"key": k, "label": LABELS.get(k, k),
                       "screen": BY_KEY[k]["screen"], "when": BY_KEY[k]["when"]}
                      for k in keys if k != "none"],
        })
    return out


def catalog_prompt(allowed: set[str] | None = None, density: str = "mid") -> str:
    """Manual del especialista para MiniMax: solo las plantillas permitidas, con su
    cuándo/cuándo-no/campos/ejemplo. `allowed` vacío = todas."""
    keys = [k for k in ALL_KEYS if not allowed or k in allowed]
    out = [
        "=== MANUAL DEL DIRECTOR DE MOTION GRAPHICS (DOCUMENTAL VIDRUSH) ===",
        "Eres un montador especialista. Para CADA escena eliges UNA plantilla de este catálogo, o",
        "'none'. La plantilla nace de lo que la voz DICE en esa ventana y del asset que hay.",
        "",
        "REGLAS QUE NO SE NEGOCIAN:",
        "0. EL TEXTO DEBE TENER SENTIDO LEÍDO SOLO. Antes de escribirlo, léelo como si no",
        "   oyeras la voz: si es un trozo de frase cortado ('Las familias enteras entraman a',",
        "   'Todavía hoy caminas por las', 'Pero deja esa postal a'), NO VALE. Un rótulo es una",
        "   unidad cerrada: un nombre, una cifra con su unidad, una afirmación completa. Nunca",
        "   cortes una oración por la mitad ni termines en preposición, artículo o conjunción.",
        "   Tampoco inventes abreviaturas ('MTP' por Metepec): escribe el nombre entero o usa 'none'.",
        "1. El texto sale del guion. No inventes datos, nombres, fechas ni fuentes.",
        "2. Nada de rótulos de género o estructura: NUNCA 'DOCUMENTAL', 'Bloque 1', 'Capítulo 2',",
        "   'Introducción'. Si no hay contenido real que mostrar, pon 'none'.",
        "3. Los números SIEMPRE en dígitos: '11', no 'once'; 'Número 11', no 'el número once'.",
        "4. Una plantilla a PANTALLA COMPLETA tapa el vídeo: como mucho el 12% de las escenas y",
        "   nunca dos en menos de 30 s. Si dudas, elige un overlay lateral.",
        "5. Si la plantilla exige una foto y la escena no la tiene, elige otra.",
        "6. No repitas la misma plantilla en dos escenas seguidas.",
        "7. Escribe SIEMPRE en el idioma de la narración.",
        "8. Si en una escena no tienes NADA concreto y cerrado que escribir, pon 'none'. Vale más",
        "   metraje limpio que un rótulo a medias. Se espera un 15-20% de 'none'.",
        "9. AUTOCONTROL antes de responder: relee cada motion_title. Si no lo pondrías tal cual en",
        "   pantalla de un documental de televisión, cámbialo o ponlo en 'none'.",
        "",
        "CATÁLOGO:",
    ]
    for k in keys:
        e = BY_KEY[k]
        ex = e["example"]
        ex_txt = " · ".join(f"{kk}={vv!r}" for kk, vv in ex.items() if kk != "narracion")
        out.append(
            f"\n▸ {k}  [{'PANTALLA COMPLETA' if e['screen'] == 'full' else 'overlay'} · {e['group']}]"
            f"\n   USAR: {e['when']}"
            f"\n   NO USAR: {e['avoid']}"
            f"\n   CAMPOS: {e['fields']}"
            f"\n   EJEMPLO — voz: \"{ex['narracion']}\" → {ex_txt}"
        )
    dens = {
        "low": "DENSIDAD BAJA: un overlay cada 12-20 s; 40-50% de escenas en 'none'; solo texto.",
        "mid": "DENSIDAD MEDIA: algo en pantalla el 55-65% del tiempo; 15-20% en 'none'.",
        "high": "DENSIDAD ALTA: algo en pantalla el 70-80% del tiempo; máximo 1 'none' seguida.",
    }.get(density, "")
    out.append("\n" + dens)
    if allowed:
        out.append("PLANTILLAS PERMITIDAS EN ESTE CANAL (lista CERRADA): "
                   + ", ".join(sorted(keys)) + ", none.")
    return "\n".join(out)
