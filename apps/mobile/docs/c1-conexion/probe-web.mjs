import {betterAuth} from 'better-auth';
import {organization,bearer} from 'better-auth/plugins';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
for(const candidate of [false,true]){
 const origin='http://localhost:3201';
 const auth=betterAuth({baseURL:origin,secret:randomBytes(48).toString('hex'),emailAndPassword:{enabled:true},plugins:[organization(),...(candidate?[bearer({requireSignature:true})]:[])]});
 const account={email:'fixture@example.test',password:randomBytes(24).toString('hex'),name:'Fixture'};
 async function post(path){return auth.handler(new Request(origin+'/api/auth/'+path,{method:'POST',headers:{'content-type':'application/json',origin,'sec-fetch-site':'same-origin'},body:JSON.stringify(account)}))}
 assert.equal((await post('sign-up/email')).status,200);
 const res=await post('sign-in/email');
 const actual={status:res.status,cookie:res.headers.has('set-cookie'),tokenHeader:res.headers.has('set-auth-token')};
 assert.deepEqual(actual,{status:200,cookie:true,tokenHeader:candidate});console.log(candidate?'organization + bearer':'organization',actual);
}
