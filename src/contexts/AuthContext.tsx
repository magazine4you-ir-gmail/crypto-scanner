import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/services/supabaseClient';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let listener: { subscription: { unsubscribe: () => void } } | null = null;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
      } catch {
        // Supabase unreachable — continue without a session
      } finally {
        setLoading(false);
      }
    })();

    try {
      const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
        setSession(newSession);
      });
      listener = data;
    } catch {
      // Supabase unreachable — skip listener
    }

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? (error.message as string) : null };
    } catch {
      return { error: 'ارتباط با سرور برقرار نشد' };
    }
  };

  const signUp = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { error: error.message as string, needsEmailConfirmation: false };
      const needsEmailConfirmation = !data.session && !data.user?.email_confirmed_at;
      return { error: null, needsEmailConfirmation };
    } catch {
      return { error: 'ارتباط با سرور برقرار نشد', needsEmailConfirmation: false };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      return { error: error ? (error.message as string) : null };
    } catch {
      return { error: 'ارتباط با سرور برقرار نشد' };
    }
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signIn, signUp, signOut, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
