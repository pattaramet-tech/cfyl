import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface AdminProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'superadmin';
  can_edit_matches: boolean;
  can_edit_goals: boolean;
  can_edit_cards: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// CLIENT-SIDE AUTH FUNCTIONS (use in browser)
// ============================================================================

export async function signInAdmin(email: string, password: string) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    return {
      success: true,
      user: data.user,
      session: data.session,
    };
  } catch (error) {
    console.error('Sign in error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Sign in failed',
    };
  }
}

export async function signOutAdmin() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error('Sign out error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Sign out failed',
    };
  }
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch (error) {
    console.error('Get user error:', error);
    return null;
  }
}

export async function getAdminProfile(userId: string): Promise<AdminProfile | null> {
  try {
    const { data, error } = await supabase
      .from('admin_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Get admin profile error:', error);
      return null;
    }

    return data as AdminProfile;
  } catch (error) {
    console.error('Get admin profile error:', error);
    return null;
  }
}

export async function isAdminAuthenticated(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user) return false;

    const profile = await getAdminProfile(user.id);
    return profile?.active === true;
  } catch (error) {
    console.error('Is admin authenticated error:', error);
    return false;
  }
}

export function getSupabaseClient() {
  return supabase;
}

// ============================================================================
// TOKEN MANAGEMENT (localStorage)
// ============================================================================

export function saveAuthToken(token: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('admin_token', token);
  }
}

export function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('admin_token');
  }
  return null;
}

export function clearAuthToken() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('admin_token');
  }
}

// ============================================================================
// WATCH AUTH STATE (for React hooks)
// ============================================================================

export function onAuthStateChange(callback: (user: User | null) => void) {
  const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
    callback(session?.user ?? null);
  });

  return data.subscription;
}
