export const EARTH_RADIUS_M = 6371000;
export function metersBetween(a: {latitude:number;longitude:number},b:{latitude:number;longitude:number}) {
  const rad = Math.PI/180;
  const dLat=(b.latitude-a.latitude)*rad, dLon=(b.longitude-a.longitude)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dLon/2)**2;
  return EARTH_RADIUS_M*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function bearingDegrees(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}) {
  const rad=Math.PI/180, y=Math.sin((b.longitude-a.longitude)*rad)*Math.cos(b.latitude*rad);
  const x=Math.cos(a.latitude*rad)*Math.sin(b.latitude*rad)-Math.sin(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.cos((b.longitude-a.longitude)*rad);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
export function headingDelta(a:number,b:number){return Math.abs(((a-b+540)%360)-180);}
export function isAhead(origin:{latitude:number;longitude:number;heading:number},hazard:{latitude:number;longitude:number;heading:number},maxBearing=60){
  return headingDelta(origin.heading,hazard.heading)<=50 && headingDelta(origin.heading,bearingDegrees(origin,hazard))<=maxBearing;
}
