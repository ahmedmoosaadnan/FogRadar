import React from 'react';
import {Dimensions,StyleSheet,Text,View} from 'react-native';
import Svg,{Circle,Defs,Line,Path,RadialGradient,Stop} from 'react-native-svg';
import {C} from '../theme/colors';
import {Icon} from './Icons';
import type {NearbyVehicle} from '../cloud/CloudContext';
import {proximityColor} from '../utils/proximity';
export {proximityColor} from '../utils/proximity';

const SIZE=Math.min(Dimensions.get('window').width-36,390),CENTER=SIZE/2,RADIUS=CENTER-17;
// These are proximity VISUALIZATION zones, not safe following distances or crash risk.
// Ambiguous GPS accuracy produces gray markers instead of false confidence.
const PALETTE={red:{bg:'#FFDFE0',border:'#FF5966',ink:'#AB1028'},yellow:{bg:'#FFF0B8',border:'#FFB522',ink:'#805700'},green:{bg:'#C8FFDC',border:'#5BF49E',ink:C.forest},uncertain:{bg:'#E4E9EA',border:'#9EAEB0',ink:'#566569'}};
export function ProximityLegend(){return <View style={s.legend}><Text style={s.legendText}>● Red ≤80 m  ·  ● Yellow 80–250 m  ·  ● Green 250–1000 m</Text><Text style={s.legendDetail}>Gray = position accuracy uncertain. Color ≠ collision-risk score.</Text></View>;}
function Marker({vehicle,heading,ownAccuracy}:{vehicle:NearbyVehicle;heading:number|null;ownAccuracy:number|null}){
 const angle=((vehicle.bearing-(heading??0)+360)%360)*Math.PI/180;
 // Very close phones can overlap the central YOUR CAR icon. Pull only its drawing outward;
 // the displayed label always uses the real server-measured distance.
 const physicalR=Math.min(RADIUS-15,(vehicle.distanceMeters/1000)*RADIUS);
 const r=Math.max(42,physicalR);
 const x=CENTER+r*Math.sin(angle),y=CENTER-r*Math.cos(angle);
 const category=proximityColor(vehicle.distanceMeters,ownAccuracy,vehicle.accuracyMeters),colors=PALETTE[category];
 return <View style={[s.vehicle,{left:x-28,top:y-17}]}>
  <View style={[s.vehicleCircle,{backgroundColor:colors.bg,borderColor:colors.border}]}><Icon name="car" size={17} color={colors.ink}/></View>
  <View style={[s.vehicleLabel,{borderColor:colors.border}]}><Text style={s.dist}>{vehicle.distanceMeters} m</Text><Text style={s.speed}>{vehicle.speedKmh??'—'} km/h</Text></View>
 </View>;
}
export function RadarCanvas({vehicles=[],heading=null,ownAccuracy=null}:{vehicles?:NearbyVehicle[];heading?:number|null;ownAccuracy?:number|null}){
 return <View style={{height:SIZE,width:SIZE,alignSelf:'center'}}>
  <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
   <Defs><RadialGradient id="radarFill"><Stop offset="0%" stopColor="#108D51"/><Stop offset="100%" stopColor="#004228"/></RadialGradient></Defs>
   <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="url(#radarFill)" stroke="#39C278" strokeWidth="1.7"/>
   {[.33,.66,1].map(v=><Circle key={v} cx={CENTER} cy={CENTER} r={RADIUS*v} stroke="#5AF2A0" strokeOpacity={0.48} strokeWidth={1.15} fill="none"/>)}
   <Line x1={15} x2={SIZE-15} y1={CENTER} y2={CENTER} stroke="#49CF88" strokeOpacity={0.27}/>
   <Line x1={CENTER} x2={CENTER} y1={15} y2={SIZE-15} stroke="#49CF88" strokeOpacity={0.27}/>
   <Path d={`M${CENTER} ${CENTER} L${CENTER-45} ${CENTER-115} A${RADIUS} ${RADIUS} 0 0 1 ${CENTER+45} ${CENTER-115}Z`} fill="#73FFD2" fillOpacity={0.11}/>
  </Svg>
  {vehicles.map(v=><Marker key={v.id} vehicle={v} heading={heading} ownAccuracy={ownAccuracy}/>)}
  <View style={[s.me,{left:CENTER-25,top:CENTER-26}]}><Icon name="car" color={C.forest} size={28}/><Text style={s.meLabel}>YOU</Text></View>
  <View style={s.north}><Text style={s.northText}>{heading===null?'NORTH ↑':'HEADING ↑'}</Text></View>
 </View>;
}
const s=StyleSheet.create({vehicle:{position:'absolute',alignItems:'center',width:56},vehicleCircle:{borderRadius:12,padding:5,borderWidth:2},vehicleLabel:{backgroundColor:'#022F20',paddingHorizontal:4,paddingVertical:3,borderRadius:7,marginTop:2,alignItems:'center',borderWidth:1},dist:{fontSize:10,fontWeight:'900',color:'white'},speed:{fontSize:8,color:'#DBFFEB'},me:{position:'absolute',width:50,alignItems:'center',backgroundColor:'white',borderRadius:12,paddingTop:5,paddingBottom:3,borderWidth:2,borderColor:'#69EBA0'},meLabel:{fontSize:8,color:C.forest,fontWeight:'900'},north:{position:'absolute',left:0,right:0,top:14,alignItems:'center'},northText:{color:'#C3F8DC',fontSize:9,fontWeight:'800',letterSpacing:1.4},legend:{alignItems:'center',paddingTop:9},legendText:{fontSize:11,color:'#D5F9E2',fontWeight:'700',textAlign:'center'},legendDetail:{fontSize:10,color:'#A6DABF',marginTop:5,textAlign:'center'}});
