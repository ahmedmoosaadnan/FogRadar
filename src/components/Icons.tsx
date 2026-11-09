import React from 'react';
import Svg, { Circle, G, Line, Path, Polyline, Rect } from 'react-native-svg';
import { C } from '../theme/colors';

type IconName = 'home' | 'radar' | 'alert' | 'settings' | 'pin' | 'network' | 'sound' | 'shield' | 'arrow' | 'wifi' | 'car' | 'clock' | 'back' | 'cloud' | 'road' | 'check' | 'offline' | 'play' | 'stop';

export function Icon({ name, size = 22, color = C.forest, strokeWidth = 2.1 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const content: Record<IconName, React.ReactNode> = {
    home: <><Path {...p} d="M3 11.5 12 4l9 7.5V21H14v-7h-4v7H3z" /></>,
    radar: <><Circle {...p} cx="12" cy="12" r="9" /><Circle {...p} cx="12" cy="12" r="5" /><Circle cx="12" cy="12" r="2" fill={color} /><Path {...p} d="M12 12 18.5 5.5" /></>,
    alert: <><Path {...p} d="M12 3 22 21H2z" /><Line {...p} x1="12" y1="9" x2="12" y2="14" /><Circle cx="12" cy="17" r="1" fill={color} /></>,
    settings: <><Circle {...p} cx="12" cy="12" r="3" /><Path {...p} d="m10 2-1 3-3 1-3-1-2 3 2 3v2l-2 3 2 3 3-1 3 1 1 3h4l1-3 3-1 3 1 2-3-2-3v-2l2-3-2-3-3 1-3-1-1-3z" /></>,
    pin: <><Path {...p} d="M12 22c-4-6-7-10-7-14a7 7 0 0 1 14 0c0 4-3 8-7 14z" /><Circle {...p} cx="12" cy="8" r="2" /></>,
    network: <><Rect x="3" y="15" width="3" height="6" rx="1" fill={color} /><Rect x="8" y="11" width="3" height="10" rx="1" fill={color} /><Rect x="13" y="7" width="3" height="14" rx="1" fill={color} /><Rect x="18" y="3" width="3" height="18" rx="1" fill={color} /></>,
    sound: <><Path {...p} d="M4 9h4l6-5v16l-6-5H4zM18 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14" /></>,
    shield: <><Path {...p} d="M12 2 21 6v6c0 5-4 8-9 10-5-2-9-5-9-10V6z" /><Polyline {...p} points="8,12 11,15 16,9" /></>,
    arrow: <><Path {...p} d="m9 5 7 7-7 7" /></>,
    wifi: <><Path {...p} d="M2 9c6-6 14-6 20 0M5 13c4-4 10-4 14 0M9 17c2-2 4-2 6 0" /><Circle cx="12" cy="21" r="1" fill={color} /></>,
    car: <><Path {...p} d="m4 15 2-7a2 2 0 0 1 2-1h8a2 2 0 0 1 2 1l2 7v5h-3v-2H7v2H4z" /><Path {...p} d="M4 14h16M6 10h12" /><Circle cx="7" cy="16.5" r="1" fill={color} /><Circle cx="17" cy="16.5" r="1" fill={color} /></>,
    clock: <><Circle {...p} cx="12" cy="12" r="9" /><Path {...p} d="M12 6v6l4 3" /></>,
    back: <><Path {...p} d="m15 5-7 7 7 7" /></>,
    cloud: <><Path {...p} d="M7 19H6a5 5 0 1 1 1-10 7 7 0 0 1 13 3 4 4 0 0 1-1 7z" /></>,
    road: <><Path {...p} d="M9 3 4 21M15 3l5 18M12 5v3M12 12v3M12 19v2" /></>,
    check: <><Polyline {...p} points="4,12 9,17 20,6" /></>,
    offline: <><Path {...p} d="M3 3 21 21M5 10a8 8 0 0 1 14-1M7 15a6 6 0 0 1 7-1" /><Circle cx="12" cy="21" r="1" fill={color} /></>,
    play: <><Path d="M7 4 21 12 7 20z" fill={color} /></>,
    stop: <><Rect x="5" y="5" width="14" height="14" rx="2" fill={color} /></>
  };
  return <Svg width={size} height={size} viewBox="0 0 24 24"><G>{content[name]}</G></Svg>;
}
