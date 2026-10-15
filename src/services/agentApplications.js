import { db, isHybrid } from '../lib/dataClient.js';
import { submitVerifiedApplication, validateAgentDocuments } from './agentOnboarding.js';

function sanitizeFileName(fileName) {
  return fileName
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

async function uploadAgentDocument(file, label) {
  const safeFileName = sanitizeFileName(file.name) || `${label}-document`;
  const documentPath = `pending/${crypto.randomUUID()}-${safeFileName}`;

  const { error } = await db.storage
    .from('agent-application-documents')
    .upload(documentPath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });

  if (error) {
    throw error;
  }

  return {
    label,
    path: documentPath,
    originalName: file.name,
    contentType: file.type || null,
  };
}

export async function createAgentApplication(form) {
  if (isHybrid) return submitVerifiedApplication(db, form);
  validateAgentDocuments(form);
  const documentPaths = [];

  if (form.businessDocument) {
    documentPaths.push(await uploadAgentDocument(form.businessDocument, 'business-registration'));
  }

  if (form.brokerLicenseDocument) {
    documentPaths.push(await uploadAgentDocument(form.brokerLicenseDocument, 'broker-license'));
  }

  const payload = {
    office_name: form.officeName,
    office_registration_number: form.officeRegistrationNumber,
    office_address: form.officeAddress || null,
    representative_name: form.representativeName,
    representative_phone: form.representativePhone,
    contact_email: form.contactEmail,
    contact_phone: form.contactPhone || null,
    document_paths: documentPaths,
  };

  const { error } = await db.from('agent_applications').insert(payload);

  if (error) {
    throw error;
  }

  return { source: 'local' };
}

// ----- 운영 관리에서 사용 -----

export async function fetchAgentApplications() {
  const { data, error } = await db
    .from('agent_applications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * 운영에서는 신청 계정의 권한과 신청 상태를 하나의 DB 트랜잭션으로 변경한다.
 * 아래 이메일 기반 처리는 로컬 데모에만 사용한다.
 */
export async function approveAgentApplication(application, reviewerNote = null) {
  if (isHybrid) {
    const { data, error } = await db.rpc('review_agent_application', { p_id: application.id, p_status: 'approved', p_note: reviewerNote });
    if (error) throw error;
    return data;
  }
  // 1) 신청서 상태 업데이트
  const { error: appError } = await db
    .from('agent_applications')
    .update({ status: 'approved', reviewer_note: reviewerNote })
    .eq('id', application.id);
  if (appError) throw appError;

  // 2) profile 찾아서 role 변경
  const { data: profile } = await db
    .from('profiles')
    .select('id, role')
    .eq('email', application.contact_email)
    .maybeSingle();

  if (!profile) {
    return {
      profileUpdated: false,
      message: '승인되었습니다. 단, 같은 이메일로 가입된 사용자가 없어 권한은 자동 부여되지 않았습니다. 신청자가 가입 후 다시 부여해주세요.',
    };
  }

  if (profile.role === 'owner' || profile.role === 'admin') {
    return {
      profileUpdated: false,
      message: `승인되었습니다. (${application.contact_email} 은 이미 ${profile.role} 권한)`,
    };
  }

  const { error: roleError } = await db
    .from('profiles')
    .update({ role: 'agent', updated_at: new Date().toISOString() })
    .eq('id', profile.id);
  if (roleError) throw roleError;

  return { profileUpdated: true, message: '승인 완료 — 해당 사용자에게 중개사 권한이 부여되었습니다.' };
}

export async function rejectAgentApplication(applicationId, reviewerNote = null) {
  if (isHybrid) {
    const { data, error } = await db.rpc('review_agent_application', { p_id: applicationId, p_status: 'rejected', p_note: reviewerNote });
    if (error) throw error;
    return data;
  }
  const { error } = await db
    .from('agent_applications')
    .update({ status: 'rejected', reviewer_note: reviewerNote })
    .eq('id', applicationId);
  if (error) throw error;
}

// 운영에서는 인증된 사용자 ID로, 로컬 데모에서는 이메일로 자기 신청서를 조회한다.
export async function fetchMyApplication(email) {
  if (!email) return null;
  const { data: sessionData, error: sessionError } = await db.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData?.session?.user?.id) return null;
  const { data, error } = await db
    .from('agent_applications')
    .select('id, office_name, status, reviewer_note, created_at, updated_at')
    .eq(isHybrid ? 'user_id' : 'contact_email', isHybrid ? sessionData.session.user.id : email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

// 첨부 문서 임시 서명 URL 생성 (private bucket)
export async function getApplicationDocumentUrl(documentPath, expiresInSec = 600) {
  const { data, error } = await db.storage
    .from('agent-application-documents')
    .createSignedUrl(documentPath, expiresInSec);
  if (error) throw error;
  return data.signedUrl;
}
