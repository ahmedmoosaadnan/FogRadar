import React from 'react';
import { Tabs } from 'expo-router';
import { C } from '../../src/theme/colors';
import { Icon } from '../../src/components/Icons';

export default function TabLayout() {
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: C.emerald,
    tabBarInactiveTintColor: C.muted,
    tabBarStyle: { height: 66, paddingTop: 7, paddingBottom: 9, backgroundColor: C.white, borderTopColor: C.border },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
  }}>
    <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({color}) => <Icon name="home" color={typeof color === 'string' ? color : C.forest} /> }} />
    <Tabs.Screen name="radar" options={{ title: 'Radar', tabBarIcon: ({color}) => <Icon name="radar" color={typeof color === 'string' ? color : C.forest} /> }} />
    <Tabs.Screen name="alerts" options={{ title: 'Advisories', tabBarIcon: ({color}) => <Icon name="alert" color={typeof color === 'string' ? color : C.forest} /> }} />
    <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({color}) => <Icon name="settings" color={typeof color === 'string' ? color : C.forest} /> }} />
  </Tabs>;
}
