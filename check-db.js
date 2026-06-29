import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/+esm';
const supabase = createClient('https://scoatqhpwkfhhinjviqr.supabase.co', 'sb_publishable_HRVWyVg47KyE2WJV7zLkSQ_Ap-y7AK-');

const oneDayAgo = new Date(Date.now() - 24*60*60*1000).toISOString();
const twoHoursAgo = new Date(Date.now() - 2*60*60*1000).toISOString();

const oldDone = await supabase.from('rooms').select('code,status,created_at').eq('status','done').lt('created_at', oneDayAgo);
const oldWaiting = await supabase.from('rooms').select('code,status,created_at').eq('status','waiting').lt('created_at', twoHoursAgo);
const allRooms = await supabase.from('rooms').select('code,status,created_at').order('created_at', {ascending: false});
const allPlayers = await supabase.from('players').select('id,room_code,name,created_at').order('created_at', {ascending: false});

console.log('=== 超过24h的已完成房间 ===');
console.log(JSON.stringify(oldDone.data, null, 2));
console.log('=== 超过2h的等待中房间 ===');
console.log(JSON.stringify(oldWaiting.data, null, 2));
console.log('=== 所有房间（最新10条）===' );
console.log(JSON.stringify(allRooms.data?.slice(0,10), null, 2));
console.log('=== 所有玩家（最新10条）===');
console.log(JSON.stringify(allPlayers.data?.slice(0,10), null, 2));
console.log('总计房间:', allRooms.data?.length, '总计玩家:', allPlayers.data?.length);
