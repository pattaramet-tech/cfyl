import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { sortCardNotePresets, validateCardNotePreset } from '@/lib/card-note-presets';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const dynamic = 'force-dynamic';

async function requireAuthenticatedAdmin(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return {
      auth: null,
      response: NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 }),
    };
  }
  return { auth, response: null };
}

async function requireCardEditor(request: NextRequest) {
  const result = await requireAuthenticatedAdmin(request);
  if (result.response || !result.auth?.profile) return result;
  if (!result.auth.profile.can_edit_cards) {
    return {
      auth: null,
      response: NextResponse.json({ error: 'No permission to edit cards' }, { status: 403 }),
    };
  }
  return result;
}

export async function GET(request: NextRequest) {
  const permission = await requireAuthenticatedAdmin(request);
  if (permission.response) return permission.response;

  const { data, error } = await supabaseAdmin
    .from('card_note_presets')
    .select('id, note, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[CARD_NOTE_PRESETS_GET] query error:', error);
    return NextResponse.json(
      { error: `Failed to load card note presets: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json(sortCardNotePresets(data || []));
}

export async function POST(request: NextRequest) {
  const permission = await requireCardEditor(request);
  if (permission.response || !permission.auth?.profile) return permission.response!;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validated = validateCardNotePreset(body.note);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('card_note_presets')
    .insert({ note: validated.note })
    .select('id, note, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'หมายเหตุนี้มีอยู่ในรายการแล้ว' }, { status: 409 });
    }
    console.error('[CARD_NOTE_PRESETS_POST] insert error:', error);
    return NextResponse.json(
      { error: `Failed to save card note preset: ${error.message}` },
      { status: 500 }
    );
  }

  await logAdminAction({
    admin: { id: permission.auth.profile.id, email: permission.auth.profile.email },
    action: 'card_note_preset.create',
    entityType: 'card_note_preset',
    entityId: data?.id,
    entityLabel: validated.note,
    newData: { note: validated.note },
  });

  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const permission = await requireCardEditor(request);
  if (permission.response || !permission.auth?.profile) return permission.response!;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    return NextResponse.json({ error: 'Preset id is required' }, { status: 400 });
  }

  const { data: existing, error: findError } = await supabaseAdmin
    .from('card_note_presets')
    .select('id, note')
    .eq('id', id)
    .maybeSingle();

  if (findError) {
    return NextResponse.json(
      { error: `Failed to load card note preset: ${findError.message}` },
      { status: 500 }
    );
  }
  if (!existing) {
    return NextResponse.json({ error: 'Card note preset not found' }, { status: 404 });
  }

  const { error: deleteError } = await supabaseAdmin
    .from('card_note_presets')
    .delete()
    .eq('id', id);

  if (deleteError) {
    console.error('[CARD_NOTE_PRESETS_DELETE] delete error:', deleteError);
    return NextResponse.json(
      { error: `Failed to delete card note preset: ${deleteError.message}` },
      { status: 500 }
    );
  }

  await logAdminAction({
    admin: { id: permission.auth.profile.id, email: permission.auth.profile.email },
    action: 'card_note_preset.delete',
    entityType: 'card_note_preset',
    entityId: id,
    entityLabel: existing.note,
    oldData: existing,
  });

  return NextResponse.json({ success: true });
}
