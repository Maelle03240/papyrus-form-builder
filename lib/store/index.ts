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
  addSection,
  updateSection,
  deleteSection,
  reorderSections,
  moveFieldToSection,
  listLogicRules,
  addLogicRule,
  updateLogicRule,
  deleteLogicRule,
  newOptionId,
  setActiveTeamId,
  readActiveTeamId,
  createTeam,
  updateTeamName,
  listTeamMembers,
  addTeamMember,
  updateTeamMemberRole,
  deleteTeamMember
} from './supabase-forms';

export {
  listProjects,
  getProject,
  getProjectForms,
  createProject,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  PROJECTS_EVENT
} from './projects';
export type { CreateProjectInput } from './projects';

export {
  listFormVersions,
  snapshotForm,
  restoreFormVersion,
  deleteFormVersion
} from './versions';

export {
  listPartners,
  createPartner,
  updatePartner,
  deletePartner,
  listProjectPartners,
  attachPartner,
  updateProjectPartner,
  detachPartner,
  setCommissionPaid,
  listContacts,
  updateContact,
  deleteContact,
  gatherProjectContacts
} from './partners';
export type { CreatePartnerInput, GatherResult } from './partners';
