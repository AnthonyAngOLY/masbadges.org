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

  async function loadMemberships(userId: string | undefined) {
    if (!userId) { setMemberships([]); return; }
    // RLS scopes this to the user's own rows (memberships_select_own).
    const { data } = await supabase
      .from('memberships')
      .select('role, partner_center_id, state, status')
      .eq('status', 'active');
    setMemberships((data ?? []) as Membership[]);
  }

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadMemberships(data.session?.user.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      loadMemberships(newSession?.user.id);
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
