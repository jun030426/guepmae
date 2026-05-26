/*
 * userManagement.js — 관리자가 사용자 목록 조회 + 역할 변경.
 * 모든 함수는 RLS 통과를 위해 admin 으로 로그인되어 있어야 함.
 */

import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

export async function fetchAllProfiles() {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, phone, role, favorite_region, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function setUserRole(userId, newRole) {
  if (!['user', 'agent', 'admin'].includes(newRole)) {
    throw new Error('잘못된 역할: ' + newRole);
  }
  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}
