import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.mjs';
const configured=Boolean(SUPABASE_URL&&SUPABASE_ANON_KEY);
let client,subscription,remoteId,revision;
const localKey='cragshare-v1-data';
export function isShared(){return configured && !!remoteId;}
export async function initStore(onChange) {
  if (!configured) return {mode:'local'};
  const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2');
  client=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
  const {data:{session}}=await client.auth.getSession();
  if(!session){const {error}=await client.auth.signInAnonymously();if(error)throw error;}
  const parsed=new URLSearchParams(location.hash.replace(/^#/,''));
  const tripId=parsed.get('trip'),invite=parsed.get('invite');
  if(tripId && invite){const {data,error}=await client.rpc('join_trip',{p_trip_id:tripId,p_invite:invite});if(error)throw error;return attach(data,onChange);}
  return {mode:'shared-ready'};
}
async function attach(result,onChange){
  remoteId=result.id;revision=result.version;
  if(subscription)await client.removeChannel(subscription);
  subscription=client.channel('trip-'+remoteId).on('postgres_changes',{event:'UPDATE',schema:'public',table:'trips',filter:`id=eq.${remoteId}`},payload=>{if(payload.new.version>revision){revision=payload.new.version;onChange(payload.new.state);}}).subscribe();
  return {mode:'shared',trip:result.state};
}
export async function createShared(trip,onChange){
  const {data,error}=await client.rpc('create_trip',{p_state:trip});if(error)throw error;
  const result=await attach(data,onChange);
  const inviteUrl=`${location.origin}${location.pathname}#trip=${data.id}&invite=${data.invite}`;
  return {...result,inviteUrl};
}
export async function loadLocal(){const data=localStorage.getItem(localKey);return data?JSON.parse(data):null;}
export async function save(trip){
  if(!isShared()){localStorage.setItem(localKey,JSON.stringify(trip));return;}
  const {data,error}=await client.rpc('save_trip_state',{p_trip_id:remoteId,p_state:trip,p_expected_version:revision});
  if(error)throw error;
  revision=data;
}
export async function disconnect(){if(subscription&&client)await client.removeChannel(subscription);remoteId=null;revision=undefined;}
