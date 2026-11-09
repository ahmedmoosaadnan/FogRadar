import React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { JourneyProvider } from '../src/context/JourneyContext';
import { CloudProvider } from '../src/cloud/CloudContext';

export default function RootLayout() {
  return <SafeAreaProvider><JourneyProvider><CloudProvider><Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="(tabs)" />
    <Stack.Screen name="offline" />
    <Stack.Screen name="gps-diagnostics" />
    <Stack.Screen name="trip-summary" />
    <Stack.Screen name="report-hazard" />
    <Stack.Screen name="server-connection" />
  </Stack></CloudProvider></JourneyProvider></SafeAreaProvider>;
}
