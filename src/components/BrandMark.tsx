import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect, Line, Circle } from 'react-native-svg';
import { C } from '../theme/colors';

export function BrandMark({ size = 116 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.24, overflow: 'hidden', backgroundColor: C.forest }}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Rect x="0" y="0" width="120" height="120" fill={C.forest} />
        <Path d="M15 113 44 62h32l29 51" fill="#008B48" />
        <Path d="M40 113 53 66h14l13 47" fill="#0B3527" />
        <Path d="M60 69v10M60 90v13" stroke="#FFF" strokeWidth="3" strokeLinecap="round" />
        <Path d="M34 59c-11-1-19-8-19-19 0-11 8-19 19-19 4 0 8 1 11 3C51 10 62 7 73 12c11 4 17 13 18 23 10 0 17 8 17 17 0 6-4 11-9 14" fill="none" stroke="#FFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M47 75 51 65c1-3 3-4 7-4h9c4 0 6 1 7 4l4 10v10h-6v-3H53v3h-6z" fill="#FFF" />
        <Rect x="53" y="67" width="19" height="7" rx="2" fill={C.forest} />
        <Line x1="51" y1="79" x2="74" y2="79" stroke={C.forest} strokeWidth="2" />
        <Circle cx="53" cy="79" r="2" fill={C.forest} /><Circle cx="72" cy="79" r="2" fill={C.forest} />
      </Svg>
    </View>
  );
}
