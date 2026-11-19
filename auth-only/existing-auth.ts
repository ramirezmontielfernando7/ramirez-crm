import { createAuthOnlyHandler } from './handler.mjs';
/** Prepared bridge. No module opens a listener and no factory is called at import time.
 * Runtime requires a clean environment supplied by a future authorized launcher.
 */
export function createExistingAuthHandler(environment:Record<string,string|undefined>){
 if(environment!==process.env)throw new Error('effective-environment-required');
 return createAuthOnlyHandler(environment,{
  identities:async()=>{
   const {getSql,getSystemSql}=await import('../src/lib/db');
   const identify=async(client:ReturnType<typeof getSql>)=>{const [row]=await client<{database:string;user:string;instance:string|null;superuser:boolean;bypassRls:boolean;version:number}[]>`select current_database() as database,current_user as "user",current_setting('dashfort.test_instance',true) as instance,r.rolsuper as superuser,r.rolbypassrls as "bypassRls",current_setting('server_version_num')::int as version from pg_roles r where r.rolname=current_user`;return row;};
   return Promise.all([identify(getSql()),identify(getSystemSql())]);
  },
  loadAuth:async()=>{const {getAuth}=await import('../src/lib/auth');return getAuth();},
 });
}
