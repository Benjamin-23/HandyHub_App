import { C } from '@/constants/handyhub-theme';

export type ServiceCategoryIcon =
  | { family: 'ionicons'; glyph: string }
  | { family: 'mci'; glyph: string };

export type ServiceCategory = {
  label: string;
  icon: ServiceCategoryIcon;
  background: string;
  color: string;
};

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  { label: 'Plumbing', icon: { family: 'mci', glyph: 'pipe-wrench' }, background: '#E9EDFB', color: '#3D57C4' },
  { label: 'Electrical', icon: { family: 'ionicons', glyph: 'flash' }, background: '#FFF0DA', color: C.orange },
  { label: 'Carpentry', icon: { family: 'mci', glyph: 'hammer' }, background: '#F1E9DD', color: '#8B5A2B' },
  { label: 'Painting', icon: { family: 'mci', glyph: 'format-paint' }, background: '#E7F3F0', color: C.teal },
  { label: 'Cleaning', icon: { family: 'ionicons', glyph: 'sparkles' }, background: '#FBE9EA', color: '#C4453D' },
  { label: 'Driver', icon: { family: 'mci', glyph: 'car' }, background: '#EFEAF9', color: C.purple },
  { label: 'Appliances', icon: { family: 'mci', glyph: 'washing-machine' }, background: '#FDF0D8', color: '#B8862E' },
  { label: 'Gardening', icon: { family: 'ionicons', glyph: 'leaf' }, background: '#E9F5E4', color: '#4C8C3A' },
  { label: 'Daycare', icon: { family: 'mci', glyph: 'human-child' }, background: '#FDEAF0', color: '#C4457E' },
  { label: 'Foreman', icon: { family: 'mci', glyph: 'account-hard-hat' }, background: '#FFF0DA', color: C.orange },
  { label: 'Construction', icon: { family: 'mci', glyph: 'crane' }, background: '#E9EDFB', color: '#3D57C4' },
  { label: 'Roofing', icon: { family: 'mci', glyph: 'home-roof' }, background: '#F1E9DD', color: '#8B5A2B' },
];

export const SERVICE_CATEGORY_LABELS = SERVICE_CATEGORIES.map((category) => category.label);
