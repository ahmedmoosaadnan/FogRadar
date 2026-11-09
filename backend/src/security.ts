import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
export type Claims={sub:string;exp:number};
export function issueToken(secret:string): {token:string;vehicleId:string;expiresAt:number} {
 const vehicleId=randomUUID();const expiresAt=Date.now()+8*3600_000;
 const payload=Buffer.from(JSON.stringify({sub:vehicleId,exp:expiresAt})).toString('base64url');
 const signature=createHmac('sha256',secret).update(payload).digest('base64url');
 return {token:`${payload}.${signature}`,vehicleId,expiresAt};
}
export function verifyToken(secret:string,token:unknown):Claims|null {
 if(typeof token!=='string' || token.length>1024)return null;
 const bits=token.split('.');if(bits.length!==2)return null;
 const [payload,signature]=bits;
 const expected=createHmac('sha256',secret).update(payload).digest();
 let got:Buffer;try{got=Buffer.from(signature,'base64url');}catch{return null;}
 if(got.length!==expected.length || !timingSafeEqual(got,expected))return null;
 try {const claims=JSON.parse(Buffer.from(payload,'base64url').toString()) as Claims;
   return typeof claims.sub==='string'&&/^[a-f0-9-]{36}$/.test(claims.sub)&&typeof claims.exp==='number'&&Date.now()<claims.exp?claims:null;
 } catch{return null;}
}
