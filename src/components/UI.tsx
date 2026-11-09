import type { ReactNode } from 'react';
import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { C } from '../theme/colors';
import { Icon } from './Icons';

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View style={{ marginBottom: 22 }}><Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>;
}
export function Pill({ label, tone = 'green' }: { label: string; tone?: 'green' | 'amber' | 'red' }) {
  const color = tone === 'red' ? C.red : tone === 'amber' ? '#9F6A00' : C.emerald;
  const bg = tone === 'red' ? '#FCE8E8' : tone === 'amber' ? '#FFF3CE' : C.pale;
  return <View style={{ alignSelf: 'flex-start', borderRadius: 100, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: bg }}><Text style={{ color, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>{label}</Text></View>;
}
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) { return <View style={[styles.card, style]}>{children}</View>; }
export function MainButton({ label, onPress, icon = 'play', disabled = false, danger = false }: { label: string; onPress: () => void; icon?: 'play' | 'stop' | 'check' | 'arrow'; disabled?: boolean; danger?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor: danger ? C.darkRed : C.emerald, opacity: disabled ? .5 : pressed ? .8 : 1 }]}><Icon name={icon} color="white" size={21} /><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
export function SettingRow({ icon, label, subtitle, right, onPress }: { icon: Parameters<typeof Icon>[0]['name']; label: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  return <Pressable disabled={!onPress} onPress={onPress} style={styles.row}><View style={styles.rowIcon}><Icon name={icon} /></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{label}</Text>{subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}</View>{right ?? (onPress ? <Icon name="arrow" color={C.muted} size={17} /> : null)}</Pressable>;
}
const styles = StyleSheet.create({
  title: { fontSize: 29, fontWeight: '900', color: C.text, letterSpacing: -.9 },
  subtitle: { fontSize: 14, color: C.muted, marginTop: 5, lineHeight: 20 },
  card: { borderRadius: 19, backgroundColor: C.white, borderColor: C.border, borderWidth: 1, padding: 17, shadowColor: '#193C29', shadowOpacity: .05, shadowRadius: 14, elevation: 2 },
  button: { borderRadius: 15, minHeight: 56, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  buttonText: { color: '#FFF', fontWeight: '800', fontSize: 17 },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 12 },
  rowIcon: { width: 43, height: 43, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: C.pale },
  rowTitle: { fontSize: 15, fontWeight: '800', color: C.text },
  rowSubtitle: { fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 3 }
});
