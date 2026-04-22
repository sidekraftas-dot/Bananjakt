const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ycimdtppexiwkbtjyusb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_WPHz81KqhGFLVHYg_IfSFA_q52Cm21p';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkScores() {
  const { data, error } = await supabase
    .from('scores')
    .select('*')
    .eq('room_code', 'global')
    .limit(50);
  
  if (error) {
    console.error(error);
    return;
  }
  
  console.log(JSON.stringify(data, null, 2));
}

checkScores();
