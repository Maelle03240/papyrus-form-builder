import type { LucideIcon } from 'lucide-react';
import {
  AlignLeft,
  AtSign,
  Banknote,
  Calculator,
  Calendar,
  CheckSquare,
  ChevronDown,
  CircleDot,
  ExternalLink,
  EyeOff,
  FileUp,
  Globe,
  Grid3X3,
  Hash,
  Heading1,
  Image as ImageIcon,
  Link2,
  MapPin,
  Minus,
  PenLine,
  Phone,
  Play,
  Rows3,
  Smile,
  Star,
  ToggleLeft,
  Type
} from 'lucide-react';
import type { FieldType } from '@/types';

interface FieldMeta {
  type: FieldType;
  label: string;
  icon: LucideIcon;
  description: string;
  hasOptions: boolean;
  hasPlaceholder: boolean;
}

export const FIELD_META: Record<FieldType, FieldMeta> = {
  short_text: { type: 'short_text', label: 'Réponse courte', icon: Type, description: 'Une ligne de texte', hasOptions: false, hasPlaceholder: true },
  long_text: { type: 'long_text', label: 'Réponse longue', icon: AlignLeft, description: 'Plusieurs lignes', hasOptions: false, hasPlaceholder: true },
  email: { type: 'email', label: 'Email', icon: AtSign, description: 'Adresse email validée', hasOptions: false, hasPlaceholder: true },
  phone: { type: 'phone', label: 'Téléphone', icon: Phone, description: 'Numéro de téléphone', hasOptions: false, hasPlaceholder: true },
  number: { type: 'number', label: 'Nombre', icon: Hash, description: 'Nombre entier ou décimal', hasOptions: false, hasPlaceholder: true },
  url: { type: 'url', label: 'Lien (URL)', icon: Link2, description: 'Adresse web validée', hasOptions: false, hasPlaceholder: true },
  single_choice: { type: 'single_choice', label: 'Choix unique', icon: CircleDot, description: 'Une seule option', hasOptions: true, hasPlaceholder: false },
  multiple_choice: { type: 'multiple_choice', label: 'Choix multiple', icon: CheckSquare, description: 'Plusieurs options', hasOptions: true, hasPlaceholder: false },
  dropdown: { type: 'dropdown', label: 'Liste déroulante', icon: ChevronDown, description: 'Menu déroulant', hasOptions: true, hasPlaceholder: false },
  rating: { type: 'rating', label: 'Note', icon: Star, description: 'Étoiles 1 à 5', hasOptions: false, hasPlaceholder: false },
  nps: { type: 'nps', label: 'Échelle de notation', icon: Smile, description: 'Boutons ou slider', hasOptions: false, hasPlaceholder: false },
  date: { type: 'date', label: 'Date', icon: Calendar, description: 'Sélecteur de date', hasOptions: false, hasPlaceholder: false },
  file: { type: 'file', label: 'Fichier', icon: FileUp, description: 'Upload de fichier', hasOptions: false, hasPlaceholder: false },
  statement: { type: 'statement', label: 'Texte libre', icon: Heading1, description: 'Bloc d\'information', hasOptions: false, hasPlaceholder: false },
  image: { type: 'image', label: 'Image', icon: ImageIcon, description: 'Photo ou illustration', hasOptions: false, hasPlaceholder: false },
  video: { type: 'video', label: 'Vidéo', icon: Play, description: 'YouTube ou Vimeo', hasOptions: false, hasPlaceholder: false },
  matrix: { type: 'matrix', label: 'Matrice', icon: Grid3X3, description: 'Tableau de questions', hasOptions: true, hasPlaceholder: false },

  // --- Phase 2 : parité avec mooove-invoice ---
  currency: { type: 'currency', label: 'Montant', icon: Banknote, description: 'Somme avec devise', hasOptions: false, hasPlaceholder: true },
  address: { type: 'address', label: 'Adresse', icon: MapPin, description: 'Adresse postale', hasOptions: false, hasPlaceholder: true },
  country: { type: 'country', label: 'Pays', icon: Globe, description: 'Liste des pays', hasOptions: false, hasPlaceholder: false },
  yesno: { type: 'yesno', label: 'Oui / Non', icon: ToggleLeft, description: 'Deux boutons', hasOptions: false, hasPlaceholder: false },
  signature: { type: 'signature', label: 'Signature', icon: PenLine, description: 'Tracée à la main', hasOptions: false, hasPlaceholder: false },
  repeater: { type: 'repeater', label: 'Bloc répétable', icon: Rows3, description: 'Lignes ajoutées à volonté', hasOptions: false, hasPlaceholder: false },
  calculated: { type: 'calculated', label: 'Champ calculé', icon: Calculator, description: 'Total en lecture seule', hasOptions: false, hasPlaceholder: false },
  link: { type: 'link', label: 'Lien ou bouton', icon: ExternalLink, description: 'Renvoie vers une page', hasOptions: false, hasPlaceholder: false },
  hidden: { type: 'hidden', label: 'Champ caché', icon: EyeOff, description: 'Rempli depuis l\'URL', hasOptions: false, hasPlaceholder: false },
  divider: { type: 'divider', label: 'Séparateur', icon: Minus, description: 'Filet horizontal', hasOptions: false, hasPlaceholder: false }
};

export const FIELD_CATEGORIES: { title: string; types: FieldType[] }[] = [
  { title: 'Texte', types: ['short_text', 'long_text', 'email', 'phone', 'url', 'address'] },
  { title: 'Choix', types: ['single_choice', 'multiple_choice', 'dropdown', 'yesno', 'country'] },
  { title: 'Évaluation', types: ['rating', 'nps', 'matrix'] },
  // `number` était déclaré dans FIELD_META mais absent de toutes les familles :
  // comme FieldPalette itère sur FIELD_CATEGORIES, le champ Nombre n'apparaissait
  // nulle part dans la palette du builder. Le catalogue s'en sert 16 fois.
  { title: 'Données', types: ['number', 'currency', 'date', 'file', 'signature'] },
  { title: 'Avancé', types: ['repeater', 'calculated', 'hidden'] },
  { title: 'Mise en page', types: ['statement', 'image', 'video', 'link', 'divider'] }
];
