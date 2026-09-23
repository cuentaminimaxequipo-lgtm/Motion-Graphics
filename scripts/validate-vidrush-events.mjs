import {readFileSync} from 'node:fs';

const allowed = new Set([
  'vidrush_evidence_matrix', 'vidrush_dossier_compare', 'vidrush_identity_cutout',
  'vidrush_inspector_lens', 'vidrush_cross_section', 'vidrush_field_profile',
  'vidrush_archive_date', 'vidrush_evidence_gallery',
]);
const minDuration = 3.8;

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/validate-vidrush-events.mjs <props.json>');
  process.exit(2);
}

const props = JSON.parse(readFileSync(file, 'utf8'));
const events = Array.isArray(props.events) ? [...props.events] : [];
const issues = [];
const editorial = events.filter((event) => allowed.has(String(event.type || '')))
  .sort((a, b) => Number(a.start || 0) - Number(b.start || 0));

for (const event of editorial) {
  const type = String(event.type);
  const title = String(event.title || '').trim();
  const image = String(event.image || '').trim();
  const duration = Number(event.duration || 0);
  if (!title) issues.push(`${event.id || type}: falta title editorial`);
  if (!image) issues.push(`${event.id || type}: falta asset real stageado`);
  if (duration < minDuration) issues.push(`${event.id || type}: ${duration}s < mínimo ${minDuration}s`);
  if (/vidrush-study|preset_lab/i.test(image)) issues.push(`${event.id || type}: usa un asset del laboratorio`);
  if (type === 'vidrush_inspector_lens') {
    for (const key of ['targetX', 'targetY']) {
      const value = Number(event[key]);
      if (!(value >= 0 && value <= 1)) issues.push(`${event.id || type}: ${key} debe estar entre 0 y 1`);
    }
  }
  if (type === 'vidrush_evidence_matrix' || type === 'vidrush_evidence_gallery') {
    const image2 = String(event.image2 || '').trim();
    if (!image2 || image2 === image) issues.push(`${event.id || type}: exige una segunda evidencia distinta`);
  }
}

for (let index = 1; index < editorial.length; index += 1) {
  const previous = editorial[index - 1];
  const current = editorial[index];
  const gap = Number(current.start || 0) - (Number(previous.start || 0) + Number(previous.duration || 0));
  if (previous.type === current.type && gap < 8) {
    issues.push(`${current.id || current.type}: repite ${current.type} demasiado pronto (${gap.toFixed(1)}s)`);
  }
}

if (issues.length) {
  console.error(`Vidrush QC rechazó ${issues.length} regla(s):\n- ${issues.join('\n- ')}`);
  process.exit(1);
}

console.log(`Vidrush QC OK: ${editorial.length} composiciones editoriales verificadas.`);
