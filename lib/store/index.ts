'use client';

/**
 * Point d'entrée unique du store.
 *
 * Ce module exportait auparavant deux implémentations interchangeables — une
 * sur localStorage, une sur Supabase — sélectionnées par NEXT_PUBLIC_LOCAL_MODE.
 * Ce mode a été retiré : il dédoublait toute la logique métier, laissait des
 * comportements diverger silencieusement entre les deux chemins, et surtout le
 * middleware désactivait purement et simplement l'authentification quand la
 * variable valait « true » — une seule variable d'environnement mal renseignée
 * en production ouvrait l'application entière.
 *
 * Il n'existe désormais qu'une source de données : Supabase.
 */

export {
  listForms,
  getForm,
  createForm,
  updateForm,
  deleteForm,
  importForm,
  addField,
  updateField,
  deleteField,
  reorderFields,
  duplicateField,
  cloneForm,
  archiveForm,
  unarchiveForm,
  setAsTemplate,
  listLogicRules,
  addLogicRule,
  updateLogicRule,
  deleteLogicRule,
  newOptionId,
  createTeam,
  updateTeamName,
  listTeamMembers,
  addTeamMember,
  updateTeamMemberRole,
  deleteTeamMember
} from './supabase-forms';
