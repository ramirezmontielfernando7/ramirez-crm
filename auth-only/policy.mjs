/** Offline preparation only. This module neither reads process.env nor opens a connection. */
const allow=new Set(['PATH','NODE_ENV','DASHFORT_PROFILE','DASHFORT_TEST_INSTANCE','APP_BASE_URL','DATABASE_URL','DATABASE_URL_SYSTEM','BETTER_AUTH_SECRET','ENCRYPTION_KEY','META_WEBHOOK_VERIFY_TOKEN','DB_POOL_MAX','DB_SYSTEM_POOL_MAX']);
export class IsolationFault extends Error {constructor(code){super(code);this.name='IsolationFault';}}
export function validateEnvironment(raw){
 if(!raw||typeof raw!=='object'||Object.keys(raw).some(k=>!allow.has(k)))throw new IsolationFault('unexpected-environment');
 if(raw.DASHFORT_PROFILE!=='isolated-auth-v1'||raw.NODE_ENV!=='test'||!/^fixture-instance-[\w-]{12,100}$/.test(raw.DASHFORT_TEST_INSTANCE??''))throw new IsolationFault('profile');
 if(raw.APP_BASE_URL!=='http://127.0.0.1:3137')throw new IsolationFault('origin');
 const bindings={};for(const [key,role]of [['DATABASE_URL','vocero_app'],['DATABASE_URL_SYSTEM','vocero_system']]){
  let u;try{u=new URL(raw[key]);}catch{throw new IsolationFault('database');}
  if(u.protocol!=='postgresql:'||u.hostname!=='db.i2p.invalid'||u.port!=='5432'||u.pathname!=='/dashfort_auth_test'||u.username!==role||u.password.length<16||u.search||u.hash||u.href!==raw[key])throw new IsolationFault('database');bindings[key]=Object.freeze({host:u.hostname,database:'dashfort_auth_test',role});
 }
 if(typeof raw.BETTER_AUTH_SECRET!=='string'||raw.BETTER_AUTH_SECRET.length<32||/placeholder|REEMPLAZA|<generate>/i.test(raw.BETTER_AUTH_SECRET))throw new IsolationFault('secret');
 if(typeof raw.ENCRYPTION_KEY!=='string'||! /^[A-Za-z0-9+/]{43}=$/.test(raw.ENCRYPTION_KEY))throw new IsolationFault('encryption-key');
 if(raw.META_WEBHOOK_VERIFY_TOKEN!=='fixture-unused-not-connected'||raw.DB_POOL_MAX!=='2'||raw.DB_SYSTEM_POOL_MAX!=='2')throw new IsolationFault('external-provider-or-pool');
 return Object.freeze({profile:raw.DASHFORT_PROFILE,origin:raw.APP_BASE_URL,instance:raw.DASHFORT_TEST_INSTANCE,bindings:Object.freeze(bindings),readyToStart:false,operationalEvidence:'required',workersEnabled:false,migrationsOnBoot:false});
}
export function verifyIdentity(plan,application,system){
 for(const [key,row]of [['DATABASE_URL',application],['DATABASE_URL_SYSTEM',system]]){
  if(!row||row.database!==plan.bindings[key].database||row.user!==plan.bindings[key].role||row.instance!==plan.instance||row.superuser!==false||row.bypassRls!==(key==='DATABASE_URL_SYSTEM')||!Number.isInteger(row.version)||row.version<180000||row.version>=190000)throw new IsolationFault('unverified-database-identity');
 }
}
export function migrationPlan(raw){
 if(raw?.profile!=='isolated-auth-v1'||raw.host!=='db.i2p.invalid'||raw.database!=='dashfort_auth_test'||raw.role!=='i2p_migrate'||raw.applicationRole!=='vocero_app'||raw.systemRole!=='vocero_system')throw new IsolationFault('migration-plan');
 return Object.freeze({readyToExecute:false,ownerAuthorization:'required',rolesNeedIsolatedClusterAdmin:true});
}
