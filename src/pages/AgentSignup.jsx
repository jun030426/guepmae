import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileUp, MailCheck, Search, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { createAgentApplication } from '../services/agentApplications.js';
import { formatPhone, PHONE_MAX_LENGTH } from '../utils/phoneFormat.js';

const PHONE_FIELDS = new Set(['representativePhone', 'contactPhone']);

const initialForm = {
  email: '',
  password: '',
  passwordConfirm: '',
  officeName: '',
  officeRegistrationNumber: '',
  officeAddress: '',
  representativeName: '',
  representativePhone: '',
  contactPhone: '',
  businessDocument: null,
  brokerLicenseDocument: null,
};

function AgentSignup() {
  const navigate = useNavigate();
  const { isAuthenticated, profile, signUp, verifySignupOtp, resendVerification, isConfigured } = useAuth();

  // 이미 로그인 상태면 password 필드 숨김 + email 자동
  const isLoggedInUser = isAuthenticated && profile?.role === 'user';
  const isLoggedInAgent = isAuthenticated && ['agent', 'admin', 'owner'].includes(profile?.role);

  const [form, setForm] = useState({
    ...initialForm,
    email: profile?.email || '',
  });
  const [officeChecked, setOfficeChecked] = useState(false);
  const [representativeVerified, setRepresentativeVerified] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 단계: 'form' → 'otp' → 'done'
  const [step, setStep] = useState('form');
  const [otpInput, setOtpInput] = useState('');
  const [isResending, setIsResending] = useState(false);

  const canSubmit = useMemo(() => {
    const accountOk = isLoggedInUser
      ? true
      : form.email && form.password.length >= 6 && form.password === form.passwordConfirm;
    return (
      accountOk &&
      officeChecked &&
      representativeVerified &&
      form.officeName &&
      form.officeRegistrationNumber &&
      form.representativeName &&
      form.representativePhone &&
      form.businessDocument &&
      form.brokerLicenseDocument
    );
  }, [form, officeChecked, representativeVerified, isLoggedInUser]);

  if (isLoggedInAgent) {
    return (
      <div className="agent-signup-page page-shell">
        <section className="agent-signup-card">
          <div className="agent-signup-heading">
            <h1>이미 중개사로 등록되어 있습니다</h1>
            <p>대시보드에서 매물 등록을 시작하세요.</p>
          </div>
          <Link to="/agent/dashboard" className="primary-link-button" style={{ marginTop: 16 }}>
            대시보드로 이동
          </Link>
        </section>
      </div>
    );
  }

  const updateForm = (event) => {
    const { name, value, files } = event.target;
    const nextValue = files ? files[0] ?? null : PHONE_FIELDS.has(name) ? formatPhone(value) : value;
    setForm((current) => ({ ...current, [name]: nextValue }));
    if (name === 'officeName' || name === 'officeRegistrationNumber') setOfficeChecked(false);
    if (name === 'representativeName' || name === 'representativePhone') setRepresentativeVerified(false);
  };

  const handleOfficeLookup = () => {
    setError('');
    if (!form.officeName || !form.officeRegistrationNumber) {
      setError('중개사무소명과 등록번호를 입력한 뒤 조회해주세요.');
      return;
    }
    setOfficeChecked(true);
  };

  const handleRepresentativeVerify = () => {
    setError('');
    if (!form.representativeName || !form.representativePhone) {
      setError('대표자명과 대표자 연락처를 입력해주세요.');
      return;
    }
    setRepresentativeVerified(true);
  };

  // 핵심: signUp + application insert 한 번에
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      // 1) 로그인 안 된 경우만 — Supabase Auth signUp
      if (!isLoggedInUser) {
        const result = await signUp({
          email: form.email,
          password: form.password,
          fullName: form.representativeName,
          phone: form.representativePhone,
          favoriteRegion: '',
        });
        // 이메일 인증 필요한 경우만 OTP 단계로
        if (result.needsEmailConfirmation) {
          // 인증 전에 application 미리 insert (anon RLS 허용)
          await createAgentApplication({ ...form, contactEmail: form.email });
          setStep('otp');
          return;
        }
        // 자동 로그인된 경우 (이메일 인증 옵션 끔) — 바로 application insert + done
      }
      // 2) 이미 로그인된 user / 자동 로그인 케이스 — application insert
      await createAgentApplication({ ...form, contactEmail: form.email });
      setStep('done');
    } catch (submitError) {
      console.error('Failed to register agent application:', submitError);
      setError(submitError.message || '신청서를 저장하지 못했습니다. 입력값과 첨부파일을 확인해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async (event) => {
    event.preventDefault();
    if (otpInput.length !== 6) {
      setError('6자리 인증번호를 정확히 입력해주세요.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      await verifySignupOtp({ email: form.email, token: otpInput });
      setStep('done');
    } catch (err) {
      setError(err.message || '인증번호가 올바르지 않거나 만료되었습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setIsResending(true);
    try {
      await resendVerification(form.email);
    } catch (err) {
      setError(err.message || '재전송 실패');
    } finally {
      setIsResending(false);
    }
  };

  // ----- 단계 3: 완료 -----
  if (step === 'done') {
    return (
      <div className="agent-signup-page page-shell">
        <section className="agent-signup-card agent-signup-done">
          <div className="agent-signup-done-icon">
            <CheckCircle2 size={48} />
          </div>
          <h1>중개사 가입 신청이 접수되었습니다</h1>
          <p className="agent-signup-done-lead">
            운영팀이 제출하신 사업자등록증과 중개등록증을 확인 후
            <strong> 영업일 기준 1~2일 내 </strong>
            결과를 이메일로 안내해드립니다.
          </p>
          <ul className="agent-signup-done-list">
            <li>승인 시: 입력하신 이메일로 안내 후 즉시 급매 PRO 이용 가능</li>
            <li>거부 시: 사유와 함께 안내드리며, 보완 후 재신청 가능</li>
            <li>승인 대기 중에는 일반 회원으로 사이트를 이용하실 수 있습니다</li>
          </ul>
          <div className="agent-signup-done-actions">
            <Link to="/agent" className="primary-link-button">급매 PRO 으로 이동</Link>
            <Link to="/" className="outline-dark-button">메인 사이트 둘러보기</Link>
          </div>
        </section>
      </div>
    );
  }

  // ----- 단계 2: OTP -----
  if (step === 'otp') {
    return (
      <div className="agent-signup-page page-shell">
        <section className="agent-signup-card">
          <form className="verification-pending" onSubmit={handleVerifyOtp}>
            <div className="verification-pending-icon" aria-hidden="true">
              <MailCheck size={36} />
            </div>
            <h1>이메일 인증</h1>
            <p className="verification-pending-target">
              <strong>{form.email}</strong> 로 6자리 인증번호를 보냈습니다.
            </p>
            <p className="verification-pending-body">
              메일에 적힌 인증번호를 입력하면 가입과 중개사 신청이 모두 완료됩니다.
            </p>

            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              className="otp-input"
              placeholder="000000"
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
            />

            {error && <p className="form-status error">{error}</p>}

            <div className="verification-pending-actions">
              <button
                type="submit"
                className="auth-submit-button"
                disabled={isSubmitting || otpInput.length !== 6}
              >
                {isSubmitting ? '인증 중...' : '인증 완료'}
              </button>
              <button
                type="button"
                className="auth-text-button"
                onClick={handleResend}
                disabled={isResending}
              >
                {isResending ? '재전송 중...' : '인증번호 다시 받기'}
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  // ----- 단계 1: 폼 -----
  return (
    <div className="agent-signup-page page-shell">
      <section className="agent-signup-card">
        <Link to="/agent" className="agent-back-link">
          <ArrowLeft size={16} />
          급매 PRO 으로 돌아가기
        </Link>

        <div className="agent-signup-heading">
          <h1>중개사 가입 신청</h1>
          <p>
            {isLoggedInUser
              ? '중개사무소 정보를 등록하면 운영팀 검토 후 1~2일 내 안내드립니다.'
              : '계정 생성과 중개사 신청을 한 번에 진행합니다. 이메일 인증 후 운영팀이 1~2일 내 검토합니다.'}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* 계정 정보 (로그인 안 된 경우만) */}
          {!isLoggedInUser && (
            <section className="agent-form-section">
              <div>
                <h2>계정 정보</h2>
                <p>가입에 사용할 이메일과 비밀번호를 입력해주세요.</p>
              </div>
              <div className="agent-section-controls">
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={updateForm}
                  placeholder="이메일"
                  autoComplete="email"
                  required
                />
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={updateForm}
                  placeholder="비밀번호 (6자 이상)"
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
                <input
                  type="password"
                  name="passwordConfirm"
                  value={form.passwordConfirm}
                  onChange={updateForm}
                  placeholder="비밀번호 확인"
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </div>
            </section>
          )}

          {isLoggedInUser && (
            <section className="agent-form-section">
              <div>
                <h2>계정</h2>
                <p>로그인된 계정으로 신청합니다.</p>
              </div>
              <div className="agent-section-controls">
                <input value={form.email} disabled />
              </div>
            </section>
          )}

          <section className="agent-form-section">
            <div>
              <h2>중개사무소 조회</h2>
              <p>중개사무소명과 등록번호를 입력한 뒤 조회해주세요.</p>
              {officeChecked && <span className="verification-chip">조회 완료</span>}
            </div>
            <div className="agent-section-controls">
              <input name="officeName" value={form.officeName} onChange={updateForm} placeholder="중개사무소명" required />
              <input name="officeRegistrationNumber" value={form.officeRegistrationNumber} onChange={updateForm} placeholder="등록번호" required />
              <input name="officeAddress" value={form.officeAddress} onChange={updateForm} placeholder="사무소 주소" />
              <button type="button" className="agent-outline-button" onClick={handleOfficeLookup}>
                <Search size={16} /> 조회하기
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
              <input name="representativeName" value={form.representativeName} onChange={updateForm} placeholder="대표자명" required />
              <input
                name="representativePhone"
                value={form.representativePhone}
                onChange={updateForm}
                placeholder="대표자 연락처 (예: 010-1234-5678)"
                inputMode="numeric"
                maxLength={PHONE_MAX_LENGTH}
                required
              />
              <button type="button" className="agent-outline-button" onClick={handleRepresentativeVerify} disabled={!officeChecked}>
                <ShieldCheck size={16} /> 인증하기
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
                <input type="file" name="businessDocument" accept="application/pdf,image/jpeg,image/png" onChange={updateForm} required />
              </label>
              <label className="agent-file-control">
                <FileUp size={18} />
                <span>{form.brokerLicenseDocument?.name || '중개등록증 첨부'}</span>
                <input type="file" name="brokerLicenseDocument" accept="application/pdf,image/jpeg,image/png" onChange={updateForm} required />
              </label>
            </div>
          </section>

          <section className="agent-form-section contact-section">
            <div>
              <h2>추가 연락처 (선택)</h2>
              <p>이메일 외 연락 가능한 번호가 있다면 입력해주세요.</p>
            </div>
            <div className="agent-section-controls">
              <input
                name="contactPhone"
                value={form.contactPhone}
                onChange={updateForm}
                placeholder="추가 연락처 (예: 02-1234-5678)"
                inputMode="numeric"
                maxLength={PHONE_MAX_LENGTH}
              />
            </div>
          </section>

          {error && <p className="form-status error">{error}</p>}

          <button type="submit" className="agent-next-button" disabled={!canSubmit || isSubmitting || !isConfigured}>
            {isSubmitting ? '접수 중...' : '가입 + 중개사 신청'}
          </button>
        </form>
      </section>
    </div>
  );
}

export default AgentSignup;
