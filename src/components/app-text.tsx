import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';

// Two-font system: the bold "display" weight — headlines, section titles,
// button labels, prominent numbers/badges — renders in Google Sans Flex;
// everything else (body copy, hints, descriptions, error messages, form
// labels) renders in PT Sans, built for paragraph readability. Across this
// app's existing design system fontWeight '800' (or heavier) is used
// exclusively for the former, so that one signal is enough to route every
// current style automatically — no need to touch each individual Text call
// site. _layout.tsx only loads the specific weights referenced below.
export function fontFamilyForWeight(weight?: TextStyle['fontWeight']): string {
  const w = String(weight ?? '400');
  if (w === '800' || w === '900') return 'GoogleSansFlex_800ExtraBold';
  return w === '600' || w === '700' || w === 'bold' ? 'PTSans_700Bold' : 'PTSans_400Regular';
}

export function Text({ style, ...props }: TextProps) {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const fontFamily = fontFamilyForWeight(flat?.fontWeight);
  return <RNText {...props} style={[style, { fontFamily, fontWeight: undefined }]} />;
}
