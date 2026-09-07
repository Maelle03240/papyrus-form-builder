'use client';

import { Plus, Trash2 } from 'lucide-react';

import { Switch } from '@/components/ui/Switch';
import { calcSourceCandidates } from '@/lib/calculated';
import { COUNTRIES } from '@/lib/constants/countries';
import { FIELD_META } from '@/lib/field-meta';
import { DEFAULT_CURRENCY } from '@/lib/submission-format';
import { cn } from '@/lib/utils';
import type {
  CalcMode,
  Field,
  FieldType,
  FieldValidation,
  Form,
  MultilingualText,
  SubField
} from '@/types';
import { REPEATER_SUBFIELD_TYPES } from '@/types';

/**
 * Réglages propres aux dix types ajoutés en phase 2.
 *
 * Le fichier est séparé de `FieldSettings` — déjà mille lignes — mais rendu à
 * l'intérieur de son onglet « Contenu » : pour l'auteur, il n'y a qu'un panneau.
 */

interface Props {
  form: Form;
  field: Field;
  onChange: (patch: Partial<Field>) => void;
}

const INPUT_CLASS =
  'w-full rounded-md border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-hidden';

export function Phase2Settings({ form, field, onChange }: Props) {
  const patchValidation = (patch: Partial<FieldValidation>) =>
    onChange({ validation: { ...field.validation, ...patch } });

  switch (field.type) {
    case 'currency':
      return (
        <Section title="Devise">
          <Field label="Code de la devise">
            <input
              value={field.validation?.currency_code ?? ''}
              onChange={(event) =>
                patchValidation({ currency_code: event.target.value.toUpperCase().slice(0, 4) })
              }
              placeholder={DEFAULT_CURRENCY}
              className={INPUT_CLASS}
            />
            <Hint>
              Trois lettres — MUR, EUR, USD. La phase 3 la reprendra du projet, pour
              que tous ses formulaires facturent dans la même monnaie.
            </Hint>
          </Field>

          <Field label="Position du symbole">
            <select
              value={field.validation?.currency_position ?? 'before'}
              onChange={(event) =>
                patchValidation({
                  currency_position: event.target.value as 'before' | 'after'
                })
              }
              className={INPUT_CLASS}
            >
              <option value="before">Avant le montant — MUR 1 500</option>
              <option value="after">Après le montant — 1 500 MUR</option>
            </select>
          </Field>

          <MinMax field={field} patchValidation={patchValidation} />
        </Section>
      );

    case 'yesno':
      return (
        <Section title="Libellés des boutons">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Réponse positive">
              <input
                value={field.validation?.yes_label ?? ''}
                onChange={(event) => patchValidation({ yes_label: event.target.value })}
                placeholder="Oui"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Réponse négative">
              <input
                value={field.validation?.no_label ?? ''}
                onChange={(event) => patchValidation({ no_label: event.target.value })}
                placeholder="Non"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
          <Hint>
            « J&apos;accepte » / « Je refuse » se lit mieux qu&apos;un oui-non sur un
            consentement.
          </Hint>
        </Section>
      );

    case 'country':
      return (
        <Section title="Pays présélectionné">
          <select
            value={field.validation?.default_country_code ?? ''}
            onChange={(event) => patchValidation({ default_country_code: event.target.value })}
            className={INPUT_CLASS}
          >
            <option value="">Aucun</option>
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
          <Hint>
            Le répondant peut toujours en changer. Présélectionner Maurice épargne un
            geste à la grande majorité.
          </Hint>
        </Section>
      );

    case 'address':
      return (
        <Section title="Hauteur du champ">
          <select
            value={String(field.validation?.address_rows ?? 3)}
            onChange={(event) =>
              patchValidation({ address_rows: Number(event.target.value) })
            }
            className={INPUT_CLASS}
          >
            <option value="2">2 lignes</option>
            <option value="3">3 lignes</option>
            <option value="4">4 lignes</option>
            <option value="5">5 lignes</option>
          </select>
          <Hint>Le champ s&apos;agrandit tout seul au-delà : c&apos;est une hauteur de départ.</Hint>
        </Section>
      );

    case 'signature':
      return (
        <Section title="Trait">
          <select
            value={String(field.validation?.signature_stroke_width ?? 2)}
            onChange={(event) =>
              patchValidation({ signature_stroke_width: Number(event.target.value) })
            }
            className={INPUT_CLASS}
          >
            <option value="1">Fin</option>
            <option value="2">Normal</option>
            <option value="3">Épais</option>
          </select>
          <Hint>
            La signature est déposée comme image et c&apos;est son adresse qui est
            enregistrée avec la réponse.
          </Hint>
        </Section>
      );

    case 'link':
      return (
        <Section title="Destination">
          <Field label="Adresse">
            <input
              value={field.validation?.link_url ?? ''}
              onChange={(event) => patchValidation({ link_url: event.target.value })}
              placeholder="https://exemple.com/billetterie"
              className={INPUT_CLASS}
            />
            <Hint>Le texte affiché est le titre de ce champ.</Hint>
          </Field>

          <Field label="Apparence">
            <select
              value={field.validation?.link_variant ?? 'button'}
              onChange={(event) =>
                patchValidation({ link_variant: event.target.value as 'button' | 'link' })
              }
              className={INPUT_CLASS}
            >
              <option value="button">Bouton</option>
              <option value="link">Lien souligné</option>
            </select>
          </Field>

          <Toggle
            checked={field.validation?.link_new_tab ?? true}
            onChange={(checked) => patchValidation({ link_new_tab: checked })}
            label="Ouvrir dans un nouvel onglet"
            hint="Recommandé : le répondant ne perd pas le formulaire en cours."
          />
        </Section>
      );

    case 'hidden':
      return (
        <Section title="Source de la valeur">
          <Field label="Clé dans l'adresse">
            <input
              value={field.validation?.hidden_key ?? ''}
              onChange={(event) =>
                patchValidation({ hidden_key: event.target.value.trim() })
              }
              placeholder="utm_source"
              className={cn(INPUT_CLASS, 'font-mono')}
            />
            <Hint>
              Avec la clé <code className="font-mono">utm_source</code>, l&apos;adresse
              <code className="font-mono"> ?utm_source=linkedin</code> enregistre
              « linkedin » sans rien demander au répondant.
            </Hint>
          </Field>

          <Field label="Valeur par défaut">
            <input
              value={field.validation?.hidden_default ?? ''}
              onChange={(event) => patchValidation({ hidden_default: event.target.value })}
              placeholder="direct"
              className={INPUT_CLASS}
            />
            <Hint>Utilisée quand la clé est absente de l&apos;adresse.</Hint>
          </Field>
        </Section>
      );

    case 'calculated':
      return <CalculatedSettings form={form} field={field} onChange={onChange} />;

    case 'repeater':
      return <RepeaterSettings field={field} onChange={onChange} />;

    default:
      return null;
  }
}

// ============================================================================
// Champ calculé
// ============================================================================

function CalculatedSettings({ form, field, onChange }: Props) {
  const calc = field.calc ?? { mode: 'count' as CalcMode, sources: [], offset: 0 };
  const others = (form.fields ?? []).filter((candidate) => candidate.id !== field.id);
  const candidates = calcSourceCandidates(others, calc.mode);

  const patch = (next: Partial<typeof calc>) => onChange({ calc: { ...calc, ...next } });

  const toggleSource = (id: string) => {
    const sources = calc.sources.includes(id)
      ? calc.sources.filter((source) => source !== id)
      : [...calc.sources, id];
    patch({ sources });
  };

  return (
    <Section title="Calcul">
      <Field label="Opération">
        <select
          value={calc.mode}
          onChange={(event) =>
            // Changer d'opération invalide les sources : un bloc répétable ne
            // s'additionne pas, un montant ne se compte pas.
            patch({ mode: event.target.value as CalcMode, sources: [] })
          }
          className={INPUT_CLASS}
        >
          <option value="count">Compter les lignes d&apos;un bloc répétable</option>
          <option value="sum">Additionner des nombres</option>
        </select>
      </Field>

      <Field label={calc.mode === 'count' ? 'Blocs à compter' : 'Champs à additionner'}>
        {candidates.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-strong bg-bg-base px-3 py-2 text-xs text-text-tertiary">
            {calc.mode === 'count'
              ? "Ce formulaire n'a encore aucun bloc répétable."
              : "Ce formulaire n'a encore aucun champ numérique."}
          </p>
        ) : (
          <div className="space-y-1">
            {candidates.map((candidate) => (
              <label
                key={candidate.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-primary transition hover:bg-bg-elevated"
              >
                <input
                  type="checkbox"
                  checked={calc.sources.includes(candidate.id)}
                  onChange={() => toggleSource(candidate.id)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="truncate">
                  {candidate.label?.fr || FIELD_META[candidate.type].label}
                </span>
              </label>
            ))}
          </div>
        )}
      </Field>

      <Field label="Ajouter au résultat">
        <input
          type="number"
          value={String(calc.offset ?? 0)}
          onChange={(event) => patch({ offset: Number(event.target.value) || 0 })}
          className={INPUT_CLASS}
        />
        <Hint>
          Pour « le nombre de participants, plus l&apos;organisateur », saisissez 1.
        </Hint>
      </Field>

      <Toggle
        checked={calc.hidden ?? false}
        onChange={(checked) => patch({ hidden: checked })}
        label="Calculer sans montrer le total"
        hint="La valeur part avec la réponse, mais le répondant ne la voit pas."
      />
    </Section>
  );
}

// ============================================================================
// Bloc répétable
// ============================================================================

function RepeaterSettings({
  field,
  onChange
}: {
  field: Field;
  onChange: (patch: Partial<Field>) => void;
}) {
  const repeater = field.repeater ?? {
    min: 1,
    max: 10,
    item_label: { fr: 'Ligne' } as MultilingualText,
    fields: [] as SubField[]
  };

  const patch = (next: Partial<typeof repeater>) =>
    onChange({ repeater: { ...repeater, ...next } });

  const patchSubfield = (id: string, next: Partial<SubField>) =>
    patch({
      fields: repeater.fields.map((subfield) =>
        subfield.id === id ? { ...subfield, ...next } : subfield
      )
    });

  const addSubfield = () =>
    patch({
      fields: [
        ...repeater.fields,
        {
          id: crypto.randomUUID(),
          type: 'short_text',
          label: { fr: '' },
          description: { fr: '' },
          placeholder: { fr: '' },
          options: [],
          required: false,
          validation: {}
        }
      ]
    });

  return (
    <>
      <Section title="Bloc répétable">
        <Field label="Nom d'une ligne">
          <input
            value={repeater.item_label?.fr ?? ''}
            onChange={(event) => patch({ item_label: { fr: event.target.value } })}
            placeholder="Participant"
            className={INPUT_CLASS}
          />
          <Hint>Au singulier : il sert au bouton « Ajouter un participant ».</Hint>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Minimum">
            <input
              type="number"
              min={1}
              value={String(repeater.min)}
              onChange={(event) => patch({ min: Math.max(1, Number(event.target.value) || 1) })}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Maximum">
            <input
              type="number"
              min={repeater.min}
              value={String(repeater.max)}
              onChange={(event) =>
                patch({ max: Math.max(repeater.min, Number(event.target.value) || repeater.min) })
              }
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      </Section>

      <Section title="Sous-questions">
        {repeater.fields.length === 0 && (
          <p className="rounded-md border border-dashed border-border-strong bg-bg-base px-3 py-2 text-xs text-text-tertiary">
            Aucune sous-question — le bloc n&apos;affichera rien tant qu&apos;il n&apos;en a pas.
          </p>
        )}

        <div className="space-y-2">
          {repeater.fields.map((subfield, index) => (
            <div
              key={subfield.id}
              className="space-y-2 rounded-lg border border-border bg-bg-base p-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                  Sous-question {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    patch({ fields: repeater.fields.filter((f) => f.id !== subfield.id) })
                  }
                  aria-label={`Supprimer la sous-question ${index + 1}`}
                  className="rounded-sm p-1 text-text-tertiary transition hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              <input
                value={subfield.label?.fr ?? ''}
                onChange={(event) => patchSubfield(subfield.id, { label: { fr: event.target.value } })}
                placeholder="Intitulé"
                className={cn(INPUT_CLASS, 'py-1.5 text-xs')}
              />

              <div className="flex items-center gap-2">
                <select
                  value={subfield.type}
                  onChange={(event) =>
                    patchSubfield(subfield.id, { type: event.target.value as FieldType })
                  }
                  className={cn(INPUT_CLASS, 'py-1.5 text-xs')}
                >
                  {REPEATER_SUBFIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {FIELD_META[type].label}
                    </option>
                  ))}
                </select>

                <label className="flex shrink-0 items-center gap-1.5 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={subfield.required}
                    onChange={(event) =>
                      patchSubfield(subfield.id, { required: event.target.checked })
                    }
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  Requis
                </label>
              </div>

              {['single_choice', 'multiple_choice', 'dropdown'].includes(subfield.type) && (
                <SubfieldOptions subfield={subfield} onPatch={patchSubfield} />
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addSubfield}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 py-2 text-xs text-text-secondary transition hover:border-accent hover:text-text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter une sous-question
        </button>

        <Hint>
          Un bloc répétable ne peut pas en contenir un autre : le formulaire
          n&apos;aurait plus de fin.
        </Hint>
      </Section>
    </>
  );
}

/**
 * Options d'une sous-question à choix, saisies une par ligne.
 *
 * La saisie ligne à ligne plutôt que l'éditeur d'options complet du
 * constructeur : le panneau fait trois cent quarante pixels de large, et une
 * sous-question ne porte ni points de score, ni image, ni sous-sous-question.
 */
function SubfieldOptions({
  subfield,
  onPatch
}: {
  subfield: SubField;
  onPatch: (id: string, next: Partial<SubField>) => void;
}) {
  const text = (subfield.options ?? []).map((option) => option.label?.fr ?? '').join('\n');

  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
        Options — une par ligne
      </label>
      <textarea
        value={text}
        rows={Math.max(2, (subfield.options ?? []).length)}
        onChange={(event) =>
          onPatch(subfield.id, {
            options: event.target.value
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line, index) => ({
                // L'identifiant reste stable tant que la ligne ne bouge pas de
                // place : une condition qui désigne cette option continue de
                // fonctionner quand on corrige une faute de frappe.
                id: subfield.options?.[index]?.id ?? crypto.randomUUID(),
                label: { fr: line }
              }))
          })
        }
        placeholder={'Végétarien\nSans gluten'}
        className={cn(INPUT_CLASS, 'resize-y py-1.5 text-xs')}
      />
    </div>
  );
}

// ============================================================================
// Petits éléments partagés
// ============================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-text-tertiary">{children}</p>;
}

function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Switch checked={checked} onChange={onChange} />
        <span className="text-xs text-text-secondary">{label}</span>
      </div>
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

function MinMax({
  field,
  patchValidation
}: {
  field: Field;
  patchValidation: (patch: Partial<FieldValidation>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Montant minimum">
        <input
          type="number"
          value={field.validation?.min ?? ''}
          onChange={(event) =>
            patchValidation({
              min: event.target.value === '' ? undefined : Number(event.target.value)
            })
          }
          placeholder="—"
          className={INPUT_CLASS}
        />
      </Field>
      <Field label="Montant maximum">
        <input
          type="number"
          value={field.validation?.max ?? ''}
          onChange={(event) =>
            patchValidation({
              max: event.target.value === '' ? undefined : Number(event.target.value)
            })
          }
          placeholder="—"
          className={INPUT_CLASS}
        />
      </Field>
    </div>
  );
}
