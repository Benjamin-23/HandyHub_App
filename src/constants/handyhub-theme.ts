import type { TextStyle } from 'react-native';

export const C = {
  ink: '#132043',
  ink2: '#1D2E5C',
  cream: '#F4EDDE',
  card: '#FFFDF8',
  accent: '#F2A93B',
  orange: '#E8622C',
  teal: '#1F7A6C',
  brand: '#8B2212',
  muted: '#8A8FA3',
  line: '#E6DCC7',
  purple: '#6B4FBB',
} as const;

// react-native-web's TextStyle typing only allows 'solid' | 'dotted' | 'dashed'
// for outlineStyle, but the browser needs the web-only 'none' keyword here —
// outlineWidth: 0 alone isn't enough, since Chrome's default :focus rule sets
// outline-style: auto independently of the declared width, which silently
// reinstates its own ring the moment the input is focused/clicked.
export const NO_WEB_OUTLINE = { outlineWidth: 0, outlineStyle: 'none' } as unknown as Pick<
  TextStyle,
  'outlineWidth' | 'outlineStyle'
>;
