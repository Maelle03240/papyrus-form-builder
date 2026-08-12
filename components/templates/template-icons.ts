import type { LucideIcon } from 'lucide-react';
import {
  Activity, AlertCircle, Award, BarChart3, BookOpen, Brain, Briefcase, Bug,
  Calendar, CalendarClock, CalendarOff, Car, ClipboardCheck, ClipboardList,
  Compass, DoorOpen, FileSignature, FileText, Gauge, Globe, GraduationCap,
  HeartHandshake, Hourglass, LayoutTemplate, LifeBuoy, Lightbulb, LogOut, Mail,
  Megaphone, MessageCircle, MessageSquare, Mic, Palette, PartyPopper, PieChart,
  Plane, Quote, Receipt, Rocket, SearchCheck, Send, ShieldAlert, ShoppingCart,
  Smile, Sparkles, Star, Target, TrendingUp, UserPlus, Users, UtensilsCrossed,
  Video
} from 'lucide-react';

/**
 * Table explicite nom d'icône → composant Lucide.
 *
 * Remplace le `import * as Icons from 'lucide-react'` de l'ancienne page. Un
 * import de barrel fait entrer l'intégralité de la bibliothèque — plus de mille
 * icônes — dans le chunk de la route, pour n'en afficher que cinquante. Cette
 * table nomme exactement celles dont le catalogue se sert, et rien d'autre.
 *
 * Toute icône ajoutée à un modèle doit être ajoutée ici : `resolveTemplateIcon`
 * retombe sinon silencieusement sur l'icône générique.
 */
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  Activity, AlertCircle, Award, BarChart3, BookOpen, Brain, Briefcase, Bug,
  Calendar, CalendarClock, CalendarOff, Car, ClipboardCheck, ClipboardList,
  Compass, DoorOpen, FileSignature, FileText, Gauge, Globe, GraduationCap,
  HeartHandshake, Hourglass, LifeBuoy, Lightbulb, LogOut, Mail, Megaphone,
  MessageCircle, MessageSquare, Mic, Palette, PartyPopper, PieChart, Plane,
  Quote, Receipt, Rocket, SearchCheck, Send, ShieldAlert, ShoppingCart, Smile,
  Sparkles, Star, Target, TrendingUp, UserPlus, Users, UtensilsCrossed, Video
};

/** Icône d'un modèle, avec repli sur l'icône générique de modèle. */
export function resolveTemplateIcon(name?: string): LucideIcon {
  if (!name) return LayoutTemplate;
  return TEMPLATE_ICONS[name] ?? LayoutTemplate;
}
