import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { createPropertyWriteHandler } from '../_shared/propertyWrite.js';

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createPropertyWriteHandler({
  admin,
  storageUrl: url.replace(/\/$/, ''),
  authenticate: async (req: Request) => {
    const authorization = req.headers.get('Authorization') || '';
    const match = authorization.match(/^Bearer\s+(\S+)$/i);
    if (!match) return null;
    const { data, error } = await admin.auth.getUser(match[1]);
    return error ? null : data.user;
  },
}));
