import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

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

  const { error } = await supabase.storage
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
  if (!isSupabaseConfigured) {
    return { source: 'local' };
  }

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

  const { error } = await supabase.from('agent_applications').insert(payload);

  if (error) {
    throw error;
  }

  return { source: 'supabase' };
}
