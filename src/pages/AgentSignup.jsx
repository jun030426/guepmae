import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileUp, Search, ShieldCheck } from 'lucide-react';
import { createAgentApplication } from '../services/agentApplications.js';

const initialForm = {
  officeName: '',
  officeRegistrationNumber: '',
  officeAddress: '',
  representativeName: '',
  representativePhone: '',
  contactEmail: '',
  contactPhone: '',
  businessDocument: null,
  brokerLicenseDocument: null,
};

function AgentSignup() {
  const [form, setForm] = useState(initialForm);
  const [officeChecked, setOfficeChecked] = useState(false);
  const [representativeVerified, setRepresentativeVerified] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(
    () =>
      officeChecked &&
      representativeVerified &&
      form.officeName &&
      form.officeRegistrationNumber &&
      form.representativeName &&
      form.representativePhone &&
      form.contactEmail &&
      form.businessDocument &&
      form.brokerLicenseDocument,
    [form, officeChecked, representativeVerified],
  );

  const updateForm = (event) => {
    const { name, value, files } = event.target;
    setForm((current) => ({
      ...current,
      [name]: files ? files[0] ?? null : value,
    }));

    if (name === 'officeName' || name === 'officeRegistrationNumber') {
      setOfficeChecked(false);
    }

    if (name === 'representativeName' || name === 'representativePhone') {
      setRepresentativeVerified(false);
    }
  };

  const handleOfficeLookup = () => {
    setStatus('');
    setError('');

    if (!form.officeName || !form.officeRegistrationNumber) {
      setError('중개사무소명과 등록번호를 입력한 뒤 조회해주세요.');
      return;
    }

    setOfficeChecked(true);
    setStatus('중개사무소 정보가 확인되었습니다.');
  };

  const handleRepresentativeVerify = () => {
    setStatus('');
    setError('');

    if (!form.representativeName || !form.representativePhone) {
      setError('대표자명과 대표자 연락처를 입력해주세요.');
      return;
    }

    setRepresentativeVerified(true);
    setStatus('대표자 인증이 완료되었습니다.');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus('');
    setError('');
    setIsSubmitting(true);

    try {
      await createAgentApplication(form);
      setStatus('중개사 가입 신청이 접수되었습니다. 운영팀 검토 후 연락드리겠습니다.');
      setForm(initialForm);
      setOfficeChecked(false);
      setRepresentativeVerified(false);
    } catch (submitError) {
      console.error('Failed to create agent application.', submitError);
      setError('신청서를 저장하지 못했습니다. 입력값과 첨부파일을 확인해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="agent-signup-page page-shell">
      <section className="agent-signup-card">
        <Link to="/login" className="agent-back-link">
          <ArrowLeft size={16} />
          로그인으로 돌아가기
        </Link>

        <div className="agent-signup-heading">
          <h1>중개사무소 정보 입력</h1>
          <p>중개사무소 정보를 등록하면 운영팀 검토 후 제휴 계정을 발급해드립니다.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <section className="agent-form-section">
            <div>
              <h2>중개사무소 조회</h2>
              <p>중개사무소명과 등록번호를 입력한 뒤 조회해주세요.</p>
              {officeChecked && <span className="verification-chip">조회 완료</span>}
            </div>
            <div className="agent-section-controls">
              <input
                name="officeName"
                value={form.officeName}
                onChange={updateForm}
                placeholder="중개사무소명"
                required
              />
              <input
                name="officeRegistrationNumber"
                value={form.officeRegistrationNumber}
                onChange={updateForm}
                placeholder="등록번호"
                required
              />
              <input
                name="officeAddress"
                value={form.officeAddress}
                onChange={updateForm}
                placeholder="사무소 주소"
              />
              <button type="button" className="agent-outline-button" onClick={handleOfficeLookup}>
                <Search size={16} />
                조회하기
              </button>
            </div>
          </section>

          <section className="agent-form-section">
            <div>
              <h2>대표자 인증</h2>
              <p>대표자 인증은 중개사무소 조회 후 진행할 수 있습니다.</p>
              {representativeVerified && <span className="verification-chip">인증 완료</span>}
            </div>
            <div className="agent-section-controls">
              <input
                name="representativeName"
                value={form.representativeName}
                onChange={updateForm}
                placeholder="대표자명"
                required
              />
              <input
                name="representativePhone"
                value={form.representativePhone}
                onChange={updateForm}
                placeholder="대표자 연락처"
                required
              />
              <button
                type="button"
                className="agent-outline-button"
                onClick={handleRepresentativeVerify}
                disabled={!officeChecked}
              >
                <ShieldCheck size={16} />
                인증하기
              </button>
            </div>
          </section>

          <section className="agent-form-section">
            <div>
              <h2>관련 제출 서류 첨부</h2>
              <p>사업자등록증과 중개등록증을 첨부해주세요.</p>
            </div>
            <div className="agent-section-controls">
              <label className="agent-file-control">
                <FileUp size={18} />
                <span>{form.businessDocument?.name || '사업자등록증 첨부'}</span>
                <input
                  type="file"
                  name="businessDocument"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={updateForm}
                  required
                />
              </label>
              <label className="agent-file-control">
                <FileUp size={18} />
                <span>{form.brokerLicenseDocument?.name || '중개등록증 첨부'}</span>
                <input
                  type="file"
                  name="brokerLicenseDocument"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={updateForm}
                  required
                />
              </label>
            </div>
          </section>

          <section className="agent-form-section contact-section">
            <div>
              <h2>연락 정보</h2>
              <p>검토 결과를 받을 연락처를 입력해주세요.</p>
            </div>
            <div className="agent-section-controls">
              <input
                type="email"
                name="contactEmail"
                value={form.contactEmail}
                onChange={updateForm}
                placeholder="이메일"
                required
              />
              <input
                name="contactPhone"
                value={form.contactPhone}
                onChange={updateForm}
                placeholder="추가 연락처"
              />
            </div>
          </section>

          <button type="submit" className="agent-next-button" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? '접수 중...' : '다음'}
          </button>
        </form>

        {status && <p className="form-status">{status}</p>}
        {error && <p className="form-status error">{error}</p>}
      </section>
    </div>
  );
}

export default AgentSignup;
