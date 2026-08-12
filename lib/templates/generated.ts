// AUTO-GÉNÉRÉ par scripts/build-template-catalog.ts — NE PAS ÉDITER À LA MAIN.
import 'server-only';
import type { TemplateDefinition, TemplateIndexEntry } from './types';
import indexJson from './catalog/index.json';

import contactGeneral from './catalog/contact-general.json';
import demandeDevis from './catalog/demande-devis.json';
import qualificationLeadB2b from './catalog/qualification-lead-b2b.json';
import inscriptionNewsletter from './catalog/inscription-newsletter.json';
import listeAttenteProduit from './catalog/liste-attente-produit.json';
import candidatureSpontanee from './catalog/candidature-spontanee.json';
import candidaturePoste from './catalog/candidature-poste.json';
import prequalificationCandidat from './catalog/prequalification-candidat.json';
import compteRenduEntretien from './catalog/compte-rendu-entretien.json';
import onboardingCollaborateur from './catalog/onboarding-collaborateur.json';
import entretienDepart from './catalog/entretien-depart.json';
import engagementCollaborateurs from './catalog/engagement-collaborateurs.json';
import pulseHebdomadaire from './catalog/pulse-hebdomadaire.json';
import demandeConge from './catalog/demande-conge.json';
import noteDeFrais from './catalog/note-de-frais.json';
import autoEvaluationAnnuelle from './catalog/auto-evaluation-annuelle.json';
import nps from './catalog/nps.json';
import csatApresService from './catalog/csat-apres-service.json';
import satisfactionDetaillee from './catalog/satisfaction-detaillee.json';
import reclamationClient from './catalog/reclamation-client.json';
import demandeTemoignage from './catalog/demande-temoignage.json';
import productMarketFit from './catalog/product-market-fit.json';
import demandeFonctionnalite from './catalog/demande-fonctionnalite.json';
import rapportBug from './catalog/rapport-bug.json';
import recrutementParticipantsRecherche from './catalog/recrutement-participants-recherche.json';
import enqueteAnnulation from './catalog/enquete-annulation.json';
import feedbackProduit from './catalog/feedback-produit.json';
import inscriptionEvenement from './catalog/inscription-evenement.json';
import rsvp from './catalog/rsvp.json';
import retourPostEvenement from './catalog/retour-post-evenement.json';
import appelIntervenants from './catalog/appel-intervenants.json';
import inscriptionWebinaire from './catalog/inscription-webinaire.json';
import briefCreatif from './catalog/brief-creatif.json';
import briefSiteWeb from './catalog/brief-site-web.json';
import questionnaireMarque from './catalog/questionnaire-marque.json';
import candidatureAmbassadeur from './catalog/candidature-ambassadeur.json';
import etudePerceptionMarque from './catalog/etude-perception-marque.json';
import voyageSurMesure from './catalog/voyage-sur-mesure.json';
import priseRendezVous from './catalog/prise-rendez-vous.json';
import bonDeCommande from './catalog/bon-de-commande.json';
import reservationRestaurant from './catalog/reservation-restaurant.json';
import transfertAeroport from './catalog/transfert-aeroport.json';
import inscriptionFormation from './catalog/inscription-formation.json';
import evaluationFormation from './catalog/evaluation-formation.json';
import quizConnaissances from './catalog/quiz-connaissances.json';
import diagnosticMaturiteIa from './catalog/diagnostic-maturite-ia.json';
import besoinsFormation from './catalog/besoins-formation.json';
import ticketSupportIt from './catalog/ticket-support-it.json';
import rapportIncident from './catalog/rapport-incident.json';
import checklistInspection from './catalog/checklist-inspection.json';
import consentementRgpdImage from './catalog/consentement-rgpd-image.json';

export const TEMPLATE_INDEX = indexJson as TemplateIndexEntry[];

const CATALOG: Record<string, TemplateDefinition> = {
  'contact-general': contactGeneral as unknown as TemplateDefinition,
  'demande-devis': demandeDevis as unknown as TemplateDefinition,
  'qualification-lead-b2b': qualificationLeadB2b as unknown as TemplateDefinition,
  'inscription-newsletter': inscriptionNewsletter as unknown as TemplateDefinition,
  'liste-attente-produit': listeAttenteProduit as unknown as TemplateDefinition,
  'candidature-spontanee': candidatureSpontanee as unknown as TemplateDefinition,
  'candidature-poste': candidaturePoste as unknown as TemplateDefinition,
  'prequalification-candidat': prequalificationCandidat as unknown as TemplateDefinition,
  'compte-rendu-entretien': compteRenduEntretien as unknown as TemplateDefinition,
  'onboarding-collaborateur': onboardingCollaborateur as unknown as TemplateDefinition,
  'entretien-depart': entretienDepart as unknown as TemplateDefinition,
  'engagement-collaborateurs': engagementCollaborateurs as unknown as TemplateDefinition,
  'pulse-hebdomadaire': pulseHebdomadaire as unknown as TemplateDefinition,
  'demande-conge': demandeConge as unknown as TemplateDefinition,
  'note-de-frais': noteDeFrais as unknown as TemplateDefinition,
  'auto-evaluation-annuelle': autoEvaluationAnnuelle as unknown as TemplateDefinition,
  'nps': nps as unknown as TemplateDefinition,
  'csat-apres-service': csatApresService as unknown as TemplateDefinition,
  'satisfaction-detaillee': satisfactionDetaillee as unknown as TemplateDefinition,
  'reclamation-client': reclamationClient as unknown as TemplateDefinition,
  'demande-temoignage': demandeTemoignage as unknown as TemplateDefinition,
  'product-market-fit': productMarketFit as unknown as TemplateDefinition,
  'demande-fonctionnalite': demandeFonctionnalite as unknown as TemplateDefinition,
  'rapport-bug': rapportBug as unknown as TemplateDefinition,
  'recrutement-participants-recherche': recrutementParticipantsRecherche as unknown as TemplateDefinition,
  'enquete-annulation': enqueteAnnulation as unknown as TemplateDefinition,
  'feedback-produit': feedbackProduit as unknown as TemplateDefinition,
  'inscription-evenement': inscriptionEvenement as unknown as TemplateDefinition,
  'rsvp': rsvp as unknown as TemplateDefinition,
  'retour-post-evenement': retourPostEvenement as unknown as TemplateDefinition,
  'appel-intervenants': appelIntervenants as unknown as TemplateDefinition,
  'inscription-webinaire': inscriptionWebinaire as unknown as TemplateDefinition,
  'brief-creatif': briefCreatif as unknown as TemplateDefinition,
  'brief-site-web': briefSiteWeb as unknown as TemplateDefinition,
  'questionnaire-marque': questionnaireMarque as unknown as TemplateDefinition,
  'candidature-ambassadeur': candidatureAmbassadeur as unknown as TemplateDefinition,
  'etude-perception-marque': etudePerceptionMarque as unknown as TemplateDefinition,
  'voyage-sur-mesure': voyageSurMesure as unknown as TemplateDefinition,
  'prise-rendez-vous': priseRendezVous as unknown as TemplateDefinition,
  'bon-de-commande': bonDeCommande as unknown as TemplateDefinition,
  'reservation-restaurant': reservationRestaurant as unknown as TemplateDefinition,
  'transfert-aeroport': transfertAeroport as unknown as TemplateDefinition,
  'inscription-formation': inscriptionFormation as unknown as TemplateDefinition,
  'evaluation-formation': evaluationFormation as unknown as TemplateDefinition,
  'quiz-connaissances': quizConnaissances as unknown as TemplateDefinition,
  'diagnostic-maturite-ia': diagnosticMaturiteIa as unknown as TemplateDefinition,
  'besoins-formation': besoinsFormation as unknown as TemplateDefinition,
  'ticket-support-it': ticketSupportIt as unknown as TemplateDefinition,
  'rapport-incident': rapportIncident as unknown as TemplateDefinition,
  'checklist-inspection': checklistInspection as unknown as TemplateDefinition,
  'consentement-rgpd-image': consentementRgpdImage as unknown as TemplateDefinition,
};

export function getTemplateDefinition(slug: string): TemplateDefinition | null {
  return CATALOG[slug] ?? null;
}

export function listTemplateDefinitions(): TemplateDefinition[] {
  return Object.values(CATALOG);
}
