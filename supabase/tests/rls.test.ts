/**
 * RLS verification — B1.3 acceptance: "a test JWT for user A cannot read/write user B's rows".
 *
 * This is the only test in the repo that talks to a real database, because it is the only way to
 * verify RLS at all: policies are enforced by Postgres, so asserting them in TypeScript proves
 * nothing. Everything else runs on mocks.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *     npx vitest run supabase/tests/rls.test.ts
 *
 * Skips itself when those are absent, so `npm test` stays credential-free.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const configured = Boolean(url && serviceKey && anonKey);
const describeIf = configured ? describe : describe.skip;

/** Two real users, so "another user's rows" means something. */
const A = { email: `rls-a-${Date.now()}@uwaterloo.ca`, password: 'test-password-a1!' };
const B = { email: `rls-b-${Date.now()}@uwaterloo.ca`, password: 'test-password-b1!' };

describeIf('row-level security', () => {
  let admin: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let userA = '';
  let userB = '';
  let termA = '';
  let courseA = '';

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });

    for (const user of [A, B]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
      });
      if (error) throw new Error(`could not create ${user.email}: ${error.message}`);
      if (user === A) userA = data.user.id;
      else userB = data.user.id;
    }

    const signIn = async (user: typeof A) => {
      const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
      const { error } = await client.auth.signInWithPassword(user);
      if (error) throw new Error(`could not sign in ${user.email}: ${error.message}`);
      return client;
    };

    clientA = await signIn(A);
    clientB = await signIn(B);

    // Seed a term and a course owned by A, using A's own authenticated client — so the seed
    // itself proves the INSERT policy permits owners.
    const term = await clientA
      .from('user_terms')
      .insert({ user_id: userA, term_label: 'RLS Term', term_date: '2026-01-01', is_current: true })
      .select('id')
      .single();
    if (term.error) throw new Error(`A could not create own term: ${term.error.message}`);
    termA = (term.data as { id: string }).id;

    const course = await clientA
      .from('user_courses')
      .insert({ user_id: userA, user_term_id: termA, code: 'RLS 101', name: 'Private' })
      .select('id')
      .single();
    if (course.error) throw new Error(`A could not create own course: ${course.error.message}`);
    courseA = (course.data as { id: string }).id;
  }, 60_000);

  afterAll(async () => {
    if (!configured) return;
    // Deleting the auth users cascades every row, which is also an implicit check that the
    // cascade delete_account() relies on actually works.
    for (const id of [userA, userB].filter(Boolean)) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 60_000);

  it('lets a user read their own rows', async () => {
    const { data, error } = await clientA.from('user_courses').select('id').eq('id', courseA);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('hides one user\'s courses from another', async () => {
    // RLS filters rather than erroring, so the tell is an EMPTY result, not a thrown error.
    const { data, error } = await clientB.from('user_courses').select('id').eq('id', courseA);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('hides one user\'s terms from another', async () => {
    const { data } = await clientB.from('user_terms').select('id').eq('id', termA);
    expect(data).toHaveLength(0);
  });

  it('stops a user updating another user\'s course', async () => {
    const { data } = await clientB
      .from('user_courses')
      .update({ name: 'hijacked' })
      .eq('id', courseA)
      .select('id');
    // The UPDATE matches no visible row, so it silently affects nothing — which is the
    // behaviour we want, but it means asserting on the DATA is essential. A test that only
    // checked `error` would pass against a wide-open table.
    expect(data ?? []).toHaveLength(0);

    const check = await clientA.from('user_courses').select('name').eq('id', courseA).single();
    expect((check.data as { name: string }).name).toBe('Private');
  });

  it('stops a user deleting another user\'s course', async () => {
    await clientB.from('user_courses').delete().eq('id', courseA);
    const check = await clientA.from('user_courses').select('id').eq('id', courseA);
    expect(check.data).toHaveLength(1);
  });

  it('stops a user inserting a row owned by someone else', async () => {
    const { error } = await clientB
      .from('user_courses')
      .insert({ user_id: userA, user_term_id: termA, code: 'EVIL 101', name: 'Forged' });
    // WITH CHECK rejects this outright rather than filtering, so here an error IS expected.
    expect(error).not.toBeNull();
  });

  it('gives clients NO read access to shared_grades at all', async () => {
    // The privacy guarantee depends on there being no SELECT policy on this table. Reads must
    // go through get_distribution(), which enforces the minimum-sample floor.
    const asUser = await clientA.from('shared_grades').select('grade').limit(1);
    const asAnon = await createClient(url!, anonKey!, { auth: { persistSession: false } })
      .from('shared_grades')
      .select('grade')
      .limit(1);

    // Either an explicit denial or an empty set is acceptable; a populated result is not.
    expect(asUser.data ?? []).toHaveLength(0);
    expect(asAnon.data ?? []).toHaveLength(0);
  });

  it('lets anyone read the catalog', async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { error } = await anon.from('catalog_courses').select('id').limit(1);
    expect(error).toBeNull();
  });

  it('stops a client writing to the catalog — the v1 leak', async () => {
    // This is the bug the whole fork-on-add design exists to prevent: in v1 a rename wrote to
    // the shared table and changed the course for everyone.
    const { error } = await clientA
      .from('catalog_courses')
      .update({ name: 'hijacked' })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    const stillClean = await clientA
      .from('catalog_courses')
      .select('id')
      .eq('name', 'hijacked');

    expect(stillClean.data ?? []).toHaveLength(0);
    // An error is the likely outcome; an empty no-op is also acceptable. What must not happen
    // is a row actually changing, which the assertion above covers either way.
    void error;
  });

  it('rejects a non-UW email at the database, not just in the client', async () => {
    const { error } = await admin.auth.admin.createUser({
      email: `rls-outsider-${Date.now()}@gmail.com`,
      password: 'test-password-x1!',
      email_confirm: true,
    });
    // Enforced by the trigger in 08_auth_storage.sql. Even the service role cannot bypass it,
    // which is the point: the TypeScript check is a message, this is the control.
    expect(error).not.toBeNull();
  });
});

if (!configured) {
  describe('row-level security', () => {
    it.skip('needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY', () => {});
  });
}
