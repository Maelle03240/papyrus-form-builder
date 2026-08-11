/**
 * Migration des médias encodés en base64 vers Cloudflare R2.
 *
 * CONTEXTE
 * Avant le passage à R2, chaque image téléversée dans le builder était encodée
 * en data URL et stockée telle quelle dans le JSON du formulaire : bannières et
 * logos dans `forms.theme`, médias de champ dans `fields.validation.media_url`.
 * Une seule image de 2 Mo pesait ~2,7 Mo une fois encodée, directement dans une
 * colonne JSONB — d'où des formulaires lents à charger et des payloads qui
 * finissaient par être rejetés.
 *
 * Ce script parcourt les formulaires existants, téléverse chaque data URL sur R2
 * et réécrit la référence par son URL publique. Les nouveaux envois passent déjà
 * directement par R2 : ce script ne concerne que l'historique.
 *
 * USAGE
 *   npx tsx scripts/migrate-media-to-r2.ts --dry-run   # inventaire, aucune écriture
 *   npx tsx scripts/migrate-media-to-r2.ts             # migration réelle
 *
 * Les variables d'environnement doivent être chargées (`.env.local`), avec la
 * clé service_role : le script écrit dans toutes les équipes.
 *
 * Il est ré-exécutable sans risque : une valeur déjà migrée n'est plus une data
 * URL et se retrouve donc ignorée au passage suivant.
 */

import { createClient } from '@supabase/supabase-js';
import { putObject, mimeFromDataUrl, validateMedia } from '../lib/storage/r2';

const DRY_RUN = process.argv.includes('--dry-run');

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov'
};

interface Stats {
  formsScanned: number;
  mediaFound: number;
  mediaMigrated: number;
  bytesFreed: number;
  failures: { formId: string; field: string; reason: string }[];
}

const stats: Stats = {
  formsScanned: 0,
  mediaFound: 0,
  mediaMigrated: 0,
  bytesFreed: 0,
  failures: []
};

function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}

/** Téléverse une data URL sur R2 et renvoie son URL publique. */
async function migrateDataUrl(dataUrl: string, scope: string): Promise<string | null> {
  const mime = mimeFromDataUrl(dataUrl);
  if (!mime) return null;

  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const buffer = Buffer.from(base64, 'base64');

  // Les limites de taille actuelles s'appliquent aussi à l'historique : un média
  // au-delà est signalé plutôt que téléversé en silence.
  const validation = validateMedia(mime, buffer.byteLength);
  if (!validation.ok) {
    throw new Error(validation.error ?? 'média invalide');
  }

  if (DRY_RUN) {
    stats.bytesFreed += dataUrl.length;
    return 'dry-run://not-uploaded';
  }

  const { publicUrl } = await putObject(
    buffer,
    mime,
    EXTENSION_BY_MIME[mime] ?? 'bin',
    scope
  );

  stats.bytesFreed += dataUrl.length;
  return publicUrl;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.');
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, { db: { schema: 'papyrus' } });

  console.log(DRY_RUN ? '— INVENTAIRE (aucune écriture) —\n' : '— MIGRATION —\n');

  const { data: forms, error } = await supabase
    .from('forms')
    .select('id, title, theme, fields(id, validation)');

  if (error) {
    console.error('Lecture des formulaires impossible :', error.message);
    process.exit(1);
  }

  for (const form of forms ?? []) {
    stats.formsScanned++;
    const theme = (form.theme ?? {}) as Record<string, unknown>;
    let themeChanged = false;

    // 1. Bannière, logo et image de fond, portés par le thème du formulaire.
    for (const key of ['banner_url', 'logo_url', 'bg_image_url'] as const) {
      const value = theme[key];
      if (!isDataUrl(value)) continue;

      stats.mediaFound++;
      try {
        const publicUrl = await migrateDataUrl(value, 'migrated');
        if (publicUrl) {
          theme[key] = publicUrl;
          themeChanged = true;
          stats.mediaMigrated++;
          console.log(`  ✓ ${form.title} · theme.${key}`);
        }
      } catch (err) {
        stats.failures.push({
          formId: form.id,
          field: `theme.${key}`,
          reason: err instanceof Error ? err.message : 'inconnu'
        });
      }
    }

    // `bg` peut dupliquer l'image de fond sous forme `url(data:...)`.
    if (typeof theme.bg === 'string' && theme.bg.includes('data:')) {
      theme.bg = typeof theme.bg_image_url === 'string' ? `url(${theme.bg_image_url})` : '';
      themeChanged = true;
    }

    if (themeChanged && !DRY_RUN) {
      const { error: updateError } = await supabase
        .from('forms')
        .update({ theme })
        .eq('id', form.id);

      if (updateError) {
        stats.failures.push({ formId: form.id, field: 'theme', reason: updateError.message });
      }
    }

    // 2. Médias insérés dans les champs.
    for (const field of (form.fields ?? []) as { id: string; validation: Record<string, unknown> }[]) {
      const validation = field.validation ?? {};
      if (!isDataUrl(validation.media_url)) continue;

      stats.mediaFound++;
      try {
        const publicUrl = await migrateDataUrl(validation.media_url, 'migrated');
        if (!publicUrl) continue;

        if (!DRY_RUN) {
          const { error: fieldError } = await supabase
            .from('fields')
            .update({ validation: { ...validation, media_url: publicUrl } })
            .eq('id', field.id);

          if (fieldError) {
            stats.failures.push({ formId: form.id, field: field.id, reason: fieldError.message });
            continue;
          }
        }

        stats.mediaMigrated++;
        console.log(`  ✓ ${form.title} · champ ${field.id}`);
      } catch (err) {
        stats.failures.push({
          formId: form.id,
          field: field.id,
          reason: err instanceof Error ? err.message : 'inconnu'
        });
      }
    }
  }

  console.log('\n— RÉSUMÉ —');
  console.log(`Formulaires analysés : ${stats.formsScanned}`);
  console.log(`Médias base64 trouvés : ${stats.mediaFound}`);
  console.log(`Médias migrés        : ${stats.mediaMigrated}`);
  console.log(`Volume retiré de la base : ${(stats.bytesFreed / 1024 / 1024).toFixed(2)} Mo`);

  if (stats.failures.length > 0) {
    console.log(`\nÉchecs (${stats.failures.length}) :`);
    for (const failure of stats.failures) {
      console.log(`  ✗ form ${failure.formId} · ${failure.field} — ${failure.reason}`);
    }
  }

  if (DRY_RUN) {
    console.log('\nAucune écriture effectuée. Relancer sans --dry-run pour migrer.');
  }
}

main().catch((err) => {
  console.error('Échec de la migration :', err);
  process.exit(1);
});
