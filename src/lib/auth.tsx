import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface Membership {
  role: string;
  partner_center_id: string | null;
  state: string | null;
  status: string;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  memberships: Membership[];
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** UX gating only. The database (RLS + has_role) is the real authority. */
  hasRole: (role: string) => boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);

  useEffect(() => {
    let active = true;
    // Auth events can overlap (initial load, token refresh, sign-out). Each
    // load claims a ticket; only the newest one is allowed to write state, so a
    // slow earlier response can't overwrite a newer one.
    let latest = 0;

    async function loadMemberships(userId: string | undefined) {
      const ticket = ++latest;
      if (!userId) { if (active) setMemberships([]); return; }

      // Filter by profile_id explicitly. RLS alone is NOT enough: the
      // memberships_select_governance policy lets chairperson, board_member and
      // chief_examiner read EVERY membership row, so an unfiltered query handed
      // those roles the whole table and hasRole() then answered true for any
      // role anyone held — system_admin included, which opens every gate.
      const { data, error } = await supabase
        .from('memberships')
        .select('role, partner_center_id, state, status')
        .eq('profile_id', userId)
        .eq('status', 'active');

      if (!active || ticket !== latest) return;
      if (error) {
        // Fail closed: no roles rather than stale ones. This only decides what
        // the UI offers; the database (RLS + has_role) is the real authority.
        console.error('Could not load memberships:', error.message);
        setMemberships([]);
        return;
      }
      setMemberships((data ?? []) as Membership[]);
    }

    supabase.auth.getSession()
      .then(async ({ data }) => {
        if (!active) return;
        setSession(data.session);
        await loadMemberships(data.session?.user.id);
      })
      .catch((e: unknown) => {
        // Without this the promise rejects, setLoading(false) never runs and the
        // whole app sits on "Loading…" forever.
        console.error('Could not restore session:', e);
      })
      .finally(() => { if (active) setLoading(false); });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      void loadMemberships(newSession?.user.id);
    });

    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const value: AuthState = {
    loading,
    session,
    user: session?.user ?? null,
    memberships,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    async signOut() {
      await supabase.auth.signOut();
    },
    hasRole(role) {
      // system_admin is all-access for UX gating, mirroring the database
      // has_role() wildcard. One check lights up the whole nav + every guard.
      const isSystemAdmin = memberships.some(
        (m) => m.role === 'system_admin' && m.status === 'active',
      );
      if (isSystemAdmin) return true;
      return memberships.some((m) => m.role === role && m.status === 'active');
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// Readable labels for the membership_role enum.
export const ROLE_LABELS: Record<string, string> = {
  board_member: 'Board Member',
  coaching_panel: 'Coaching Panel',
  chairperson: 'Chairperson',
  chief_examiner: 'Chief Examiner',
  examiner_trainer: 'Examiner Course Trainer',
  instructor_trainer: 'Instructor Trainer',
  examiner: 'Examiner',
  instructor: 'Instructor',
  partner_center_admin: 'Centre Admin',
  system_admin: 'System Administrator',
  finance_officer: 'Finance Officer',
  finance_approver: 'Finance Approver',
};
