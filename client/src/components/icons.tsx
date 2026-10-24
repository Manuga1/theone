// Domain / category → icon + colour. Keyed by the top-level ontology slug segment so any concept slug resolves.
import type { ComponentType } from 'react';
import {
  Users, Dna, Stethoscope, HeartPulse, Footprints, Leaf, UsersRound, Target, ScanLine, Activity, Pill, FlaskConical, Image, Watch, Utensils,
  Moon, Dumbbell, Droplets, Scale, ClipboardList, Bug, Zap, Database, Building2, Microscope, FileText, Camera, type LucideProps,
} from 'lucide-react';

export type IconCmp = ComponentType<LucideProps>;
export type DomainStyle = { icon: IconCmp; color: string; soft: string };

export const DOMAIN_STYLE: Record<string, DomainStyle> = {
  demographics: { icon: Users, color: '#1d6ef5', soft: '#e8f0fe' },
  biology: { icon: Dna, color: '#7b55d6', soft: '#efe9fb' },
  genomics: { icon: Dna, color: '#7b55d6', soft: '#efe9fb' },
  clinical: { icon: Stethoscope, color: '#1397a8', soft: '#e3f5f7' },
  physiology: { icon: HeartPulse, color: '#1a9e5c', soft: '#e4f6ec' },
  behavior: { icon: Footprints, color: '#e09a1e', soft: '#fdf2dc' },
  environment: { icon: Leaf, color: '#3a9c5d', soft: '#e6f4ea' },
  family: { icon: UsersRound, color: '#d6646b', soft: '#fbe8e9' },
  outcomes: { icon: Target, color: '#1559c9', soft: '#e8f0fe' },
  imaging: { icon: ScanLine, color: '#5b6b85', soft: '#eef2f7' },
};

export const LEAF_ICON: Record<string, IconCmp> = {
  heart_rate: Activity,
  blood_pressure: HeartPulse,
  medications: Pill,
  labs: FlaskConical,
  imaging: Image,
  wearables: Watch,
  nutrition: Utensils,
  food_log: Utensils,
  sleep: Moon,
  strength: Dumbbell,
  glucose: Droplets,
  cgm: Droplets,
  weight: Scale,
  surveys: ClipboardList,
  microbiome: Bug,
  ecg: Zap,
  ehr: Database,
  org: Building2,
  exome: Microscope,
  document: FileText,
  photo: Camera,
};

export function domainStyle(slug: string): DomainStyle {
  const head = slug.split('.')[0];
  return DOMAIN_STYLE[head] ?? DOMAIN_STYLE[slug] ?? { icon: Database, color: '#5b6b85', soft: '#eef2f7' };
}

export function leafIcon(slug: string): IconCmp {
  const parts = slug.split('.');
  for (let i = parts.length - 1; i >= 0; i--) {
    const hit = LEAF_ICON[parts[i]];
    if (hit) return hit;
  }
  return domainStyle(slug).icon;
}

export const CATEGORY_COLOR: Record<string, string> = {
  clinical: '#1397a8',
  labs: '#1a9e5c',
  medications: '#d64545',
  imaging: '#5b6b85',
  devices: '#1d6ef5',
  genomics: '#7b55d6',
  research: '#e09a1e',
  lifestyle: '#3a9c5d',
  other: '#8d99b0',
};
