const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ycimdtppexiwkbtjyusb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_WPHz81KqhGFLVHYg_IfSFA_q52Cm21p';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function consolidate() {
  const { data: scores, error } = await supabase.from('scores').select('*');
  if (error) return console.error(error);

  const groups = {};
  scores.forEach(s => {
    const key = s.user_id || s.player_name;
    const room = s.room_code;
    const compositeKey = `${key}_${room}`;
    if (!groups[compositeKey]) groups[compositeKey] = [];
    groups[compositeKey].push(s);
  });

  for (const compositeKey in groups) {
    const rows = groups[compositeKey];
    if (rows.length > 1) {
      const totalScore = rows.reduce((sum, r) => sum + r.score, 0);
      const mainId = rows[0].id;
      const otherIds = rows.slice(1).map(r => r.id);

      console.log(`Consolidating ${rows.length} rows for ${rows[0].player_name} in ${rows[0].room_code}. Total: ${totalScore}`);
      
      await supabase.from('scores').update({ score: totalScore }).eq('id', mainId);
      await supabase.from('scores').delete().in('id', otherIds);
    }
  }
  console.log('Done.');
}

consolidate();
