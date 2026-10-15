const BUCKET = 'agent-application-documents';
const TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
export function validateAgentDocuments(form) {
  for (const file of [form.businessDocument, form.brokerLicenseDocument]) {
    if (!file || !TYPES.has(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
      throw new Error('사업자등록증과 중개사 자격 서류는 각각 10MB 이하의 PDF·JPG·PNG 파일로 첨부해주세요.');
    }
  }
}

export async function submitVerifiedApplication(client, form) {
  validateAgentDocuments(form);
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.user?.id) throw new Error('이메일 인증 후 로그인한 계정으로 신청해주세요.');
  const uid = data.session.user.id;
  const id = form.applicationId || crypto.randomUUID();
  const bucket = client.storage.from(BUCKET);
  const docs = [];
  try {
    for (const [label, file] of [['business-registration', form.businessDocument], ['broker-license', form.brokerLicenseDocument]]) {
      const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[file.type];
      const path = `${uid}/${id}/${label}-${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error(`${label === 'business-registration' ? '사업자등록증' : '중개사 자격 서류'} 업로드 실패: ${uploadError.message}`);
      docs.push({ label, path, originalName: file.name, contentType: file.type });
    }
    const { data: submitted, error: submitError } = await client.rpc('submit_agent_application', {
      p_id: id,
      p_details: { office_name: form.officeName, office_registration_number: form.officeRegistrationNumber,
        office_address: form.officeAddress, representative_name: form.representativeName,
        representative_phone: form.representativePhone, contact_phone: form.contactPhone },
      p_documents: docs,
    });
    if (submitError) throw new Error(submitError.message);
    if (submitted.alreadySubmitted) await bucket.remove(docs.map(doc => doc.path));
    return submitted;
  } catch (failure) {
    // A lost response may hide a successful submission. Confirm first; storage
    // policy also prevents deletion of any document attached to an application.
    const saved = await client.from('agent_applications').select('id,status').eq('id', id).maybeSingle();
    if (saved.data) return saved.data;
    if (!saved.error && docs.length) await bucket.remove(docs.map(doc => doc.path));
    throw failure;
  }
}
