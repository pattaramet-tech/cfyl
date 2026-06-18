import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Auth error:', error);
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    if (!data.user || !data.session) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 }
      );
    }

    // Verify admin profile exists
    const userId = data.user.id;
    console.log(`[LOGIN] Auth successful for user: ${userId}`);

    const { data: adminProfile, error: profileError } = await supabase
      .from('admin_profiles')
      .select('id, email, full_name, active, role, can_edit_matches, can_edit_goals, can_edit_cards')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.error(`[LOGIN] Profile query error for ${userId}:`, profileError);
      return NextResponse.json(
        { error: `Admin profile not found (DB error: ${profileError.message})` },
        { status: 401 }
      );
    }

    if (!adminProfile) {
      console.error(`[LOGIN] No admin profile found for user: ${userId}`);
      console.log(`[LOGIN] User ID from auth: ${userId}`);
      console.log(`[LOGIN] User email from auth: ${data.user.email}`);
      return NextResponse.json(
        { error: 'Admin profile not found - user is not registered as admin' },
        { status: 401 }
      );
    }

    console.log(`[LOGIN] Admin profile found:`, {
      id: adminProfile.id,
      email: adminProfile.email,
      role: adminProfile.role,
      active: adminProfile.active,
    });

    if (!adminProfile.active) {
      console.warn(`[LOGIN] Admin account inactive: ${adminProfile.email}`);
      return NextResponse.json(
        { error: 'Admin account is inactive' },
        { status: 401 }
      );
    }

    // Return success with token and user info
    const token = data.session.access_token;
    console.log(`[LOGIN] Login successful for ${adminProfile.email}, token generated`);
    console.log(`[LOGIN] Token (first 50 chars): ${token.substring(0, 50)}...`);

    return NextResponse.json(
      {
        success: true,
        token: token,
        user: {
          id: data.user.id,
          email: data.user.email,
          full_name: adminProfile.full_name,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
