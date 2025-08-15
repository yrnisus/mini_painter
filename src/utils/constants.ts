import { MaskingGroup } from '../types';

export const PAINT_COLORS: string[] = [
  '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#800000', '#008000', '#000080', '#808000', '#800080', '#008080',
  '#FFA500', '#FFC0CB', '#A52A2A', '#808080', '#000000', '#FFFFFF'
];

export const BACKGROUND_COLORS: { name: string; color: number }[] = [
  { name: 'White', color: 0xffffff },
  { name: 'Light Gray', color: 0x808080 },
  { name: 'Dark Gray', color: 0x404040 },
  { name: 'Black', color: 0x000000 },
  { name: 'Blue', color: 0x87ceeb }
];

// Updated to match AI backend groups
export const MASKING_GROUPS: MaskingGroup[] = [
  { id: 'base_support', name: 'Base & Support', color: '#654321', visible: true },
  { id: 'lower_section', name: 'Lower Section', color: '#8B4513', visible: true },
  { id: 'main_body', name: 'Main Body', color: '#C0C0C0', visible: true },
  { id: 'upper_section', name: 'Upper Section', color: '#800080', visible: true },
  { id: 'details', name: 'Fine Details', color: '#FDBCB4', visible: true }
];

// Legacy groups for fallback when AI is not available
export const FALLBACK_MASKING_GROUPS: MaskingGroup[] = [
  { id: 'armor', name: 'Armor', color: '#8B4513', visible: true },
  { id: 'weapon', name: 'Weapon', color: '#C0C0C0', visible: true },
  { id: 'cloak', name: 'Cloak', color: '#800080', visible: true },
  { id: 'skin', name: 'Skin', color: '#FDBCB4', visible: true },
  { id: 'base', name: 'Base', color: '#654321', visible: true }
];