import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://veacmwwveluurkuxfyeq.supabase.co';
const supabaseKey = 'sb_publishable_4JxXVxtid5vcXC7zafOhrA_oqtAuycJ';

export const supabase = createClient(supabaseUrl, supabaseKey);
