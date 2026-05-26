/*
 * userManagement.js — 관리자/대표자가 사용자 목록 조회 + 권한 변경 + 정지/해제.
 *
 * 권한 계층:
 *   owner > admin > agent > user
 *
 * RLS 가 실제 권한 검증을 하지만, UX 차원에서 클라이언트도 사전 검증.
 */

import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

export const ROLES = ['user', 'agent', 'admin', 'owner'];
export const ROLE_LABEL = {
  owner: '대표자',
  admin: '관리자',
  agent: '중개사',
  user: '일반회원',
};

/**
 * 현재 사용자(actor)가 target 의 역할을 변경할 수 있는지.
 * - 자신의 역할은 못 바꿈
 * - owner: 누구든 변경 가능 (자신 제외) — owner 로의 승격은 SQL 로만
 * - admin: target 이 user 또는 agent 일 때만, 그리고 새 역할도 user/agent 만
 */
export function canChangeRole(actor, target, newRole) {
  if (!actor || !target) return false;
  if (actor.id === target.id) return false;
  if (target.role === 'owner') return false; // owner 는 누구도 못 건드림
  if (actor.role === 'owner') {
    return ['user', 'agent', 'admin'].includes(newRole);
  }
  if (actor.role === 'admin') {
    return ['user', 'agent'].includes(target.role) && ['user', 'agent'].includes(newRole);
  }
  return false;
}

/**
 * actor 가 target 을 정지(또는 해제)할 수 있는지.
 * - 자신은 못 정지
 * - owner: 누구든 정지 (자신/다른 owner 제외)
 * - admin: target 이 user 또는 agent 일 때만
 */
export function canToggleSuspend(actor, target) {
  if (!actor || !target) return false;
  if (actor.id === target.id) return false;
  if (target.role === 'owner') return false;
  if (actor.role === 'owner') return true;
  if (actor.role === 'admin') return ['user', 'agent'].includes(target.role);
  return false;
}

export function allowedNewRoles(actor, target) {
  if (!actor || !target) return [];
  if (actor.id === target.id) return [];
  if (target.role === 'owner') return [];
  if (actor.role === 'owner') return ['user', 'agent', 'admin'];
  if (actor.role === 'admin') return ['user', 'agent'];
  return [];
}

export async function fetchAllProfiles() {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, phone, role, favorite_region, suspended, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function setUserRole(userId, newRole) {
  if (!ROLES.includes(newRole) || newRole === 'owner') {
    throw new Error('잘못된 역할: ' + newRole);
  }
  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

export async function setUserSuspended(userId, suspended) {
  const { error } = await supabase
    .from('profiles')
    .update({ suspended, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}
