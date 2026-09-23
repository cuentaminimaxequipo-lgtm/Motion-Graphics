# Auditoría de motion graphics Vidrush

## Alcance y criterio

Se analizaron los vídeos completos descargados de ocho canales de referencia y sus secuencias a 4 fps, no los textos existentes en el pipeline. Esta auditoría describe mecanismos visuales observables; no reutiliza logos, vídeo ni copy de los canales en producción.

| Canal | Muestra observada | Mecanismos que sí importan |
| --- | --- | --- |
| Forgotten Recipes & Traditions | `forgotten_full`, 00:12 / 01:12 | Dos fotos de archivo sobre retícula, etiquetas ámbar contextuales y transición de textura/luz hacia metraje. |
| Eli Yoder | `eli_yoder`, 00:54 / 03:00 | Cifra tipográfica breve, fotos conectadas, panel físico de papel y badges que se posan junto al sujeto. |
| American Secrets | `american_secrets`, 02:00 | Dossier oscuro, versiones fechadas, documentos, énfasis rojo y frase revelada; la información se descubre, no se enumera. |
| History Vault | `history_vault`, 02:00 | Arte o recreación a pantalla completa, disolvencia entre épocas y fecha construida palabra por palabra. |
| Griffith Elijah | `griffith_elijah`, 00:48 | Explicación física con corte del terreno, tubería/ruta y etiquetas funcionales; se mantiene el tiempo suficiente para entenderla. |
| Firearms Vault | `firearms_vault`, 02:12 / 03:00 | Foto técnica, callout fino y lente que se desplaza hasta una pieza; no hay tarjeta de especificaciones genérica. |
| Yesterday's Brands | `yesterdays_brands`, 00:24 | Persona recortada en B/N, silueta fucsia desplazada, nombre que se arma y composición negra de identidad. |
| Make Tech Future | `make_tech_future`, 00:48 / 01:36 | Ficha de protagonista sobre entorno real, inserto fotográfico, nombre a máquina; después, fotos que se separan en un lienzo de evidencia. |

## Gramática común

1. El b-roll o archivo es el protagonista. El motion ocupa la pantalla solo cuando la acción narrativa exige construir una relación que el plano no puede contar por sí solo.
2. El formato procede de la función: comparar evidencia, presentar un sujeto, inspeccionar un mecanismo, explicar una estructura física o marcar un giro temporal. No se elige por “quiero un preset bonito”.
3. Las etiquetas son cortas y están ancladas a un objeto, documento o foto. Los nombres y fechas se construyen; no caen todos a la vez como un lower-third.
4. Las transiciones son de montaje: corte duro, cruce de archivo, textura o una composición que colapsa. No hay un fundido decorativo repetido entre cada escena.
5. El color y la fuente cambian con el subgénero: ámbar/crema para archivo, fucsia para identidad de marca, amarillo funcional para una explicación técnica, blanco a máquina para perfil de campo. No existe una retícula azul universal.

## Traducción a producción

El runtime implementa ocho intenciones cerradas:

- `vidrush_evidence_matrix`
- `vidrush_dossier_compare`
- `vidrush_identity_cutout`
- `vidrush_inspector_lens`
- `vidrush_cross_section`
- `vidrush_field_profile`
- `vidrush_archive_date`
- `vidrush_evidence_gallery`

Cada intención recibe los datos y assets de la escena. El staging copia una imagen real o extrae un frame del clip a `public/`; si no existe, la intención editorial se omite. `evidence_matrix` y `evidence_gallery` se rechazan sin dos evidencias distintas. Esto evita que el runtime sustituya una ausencia de assets con la maqueta del laboratorio.

## Control estricto antes de render

Ejecutar desde `motion/remotion_runtime` tras preparar los props:

```powershell
node .\scripts\validate-vidrush-events.mjs .\props_<job>.json
```

El QC rechaza: un asset de laboratorio en producción, piezas de menos de 3,8 s, una lente sin coordenada de detalle, matriz/galería sin segunda evidencia y la repetición inmediata de la misma intención.

La composición de revisión es `VidrushReferenceStudy`. Sirve para comprobar gesto, jerarquía y timing; no se usa como plantilla de vídeo final.
