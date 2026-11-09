// Display-only heuristic. NOT a traffic safety / collision risk classification.
export type ProximityColor='red'|'yellow'|'green'|'uncertain';
export function proximityColor(distanceMeters:number,ownAccuracy:number|null,otherAccuracy:number):ProximityColor {
 if(!Number.isFinite(distanceMeters)||distanceMeters<0||distanceMeters>1000)return 'uncertain';
 if(ownAccuracy===null||ownAccuracy>35||otherAccuracy>35)return 'uncertain';
 const uncertainty=ownAccuracy+otherAccuracy;
 if(distanceMeters<=80)return distanceMeters+uncertainty<=80?'red':'uncertain';
 if(distanceMeters<=250)return distanceMeters-uncertainty>80&&distanceMeters+uncertainty<=250?'yellow':'uncertain';
 return distanceMeters-uncertainty>250?'green':'uncertain';
}
