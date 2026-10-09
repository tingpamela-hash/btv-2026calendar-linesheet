// Shared by the Edge Function and offline tests; never trusts decoded JWT claims.
export async function authorizeReminder(req, { secret, client }) {
  const supplied = req.headers.get('x-btv-reminder-secret');
  if (secret && secret.length >= 32 && supplied && equalSecret(supplied, secret)) return true;
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.get('authorization') || '');
  if (!match) return false;
  try {
    const { data, error } = await client.auth.getUser(match[1]);
    if (error || !data?.user?.id) return false;
    const result = await client.from('user_profiles').select('is_admin').eq('id', data.user.id).single();
    return !result.error && result.data?.is_admin === true;
  } catch {
    return false;
  }
}

function equalSecret(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let i = 0; i < right.length; i++) difference |= (left[i] || 0) ^ right[i];
  return difference === 0;
}
