import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileUp, MailCheck } from 'lucide-react';
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
  const { isAuthenticated, profile, signUp, verifySignupOtp, resendVerification, isConfigured } = useAuth();

  // 이미 로그인 상태면 password 필드 숨김 + email 자동
  const isLoggedInUser = isAuthenticated && profile?.role === 'user';
  const isLoggedInAgent = isAuthenticated && ['agent', 'admin', 'owner'].includes(profile?.role);

  const [form, setForm] = useState({
    ...initialForm,
    email: profile?.email || '',
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 단계: 'form' → 'otp' → 'done'
  const [step, setStep] = useState('form');
  const [otpInput, setOtpInput] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendDone, setResendDone] = useState(false);

  const canSubmit = useMemo(() => {
    const accountOk = isLoggedInUser
      ? true
      : form.email.trim() && form.password.length >= 6 && form.password === form.passwordConfirm;
    return (
      accountOk &&
      form.officeName.trim() &&
      form.officeRegistrationNumber.trim() &&
      form.representativeName.trim() &&
      form.representativePhone.trim() &&
      form.businessDocument &&
      form.brokerLicenseDocument
    );
  }, [form, isLoggedInUser]);

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
  };

  // 핵심: signUp + application insert 한 번에
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting || !isConfigured) return;
    if (!canSubmit) {
      setError('필수 정보와 첨부 서류를 확인해주세요. 비밀번호는 6자 이상이며 확인 값과 같아야 합니다.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    // 계정 생성 후 신청서 저장이 실패하면, 같은 이메일로 재가입이 막히는 막다른 길이 된다 —
    // 실패 안내에서 "로그인 후 재신청" 경로를 정확히 알려주기 위해 단계를 추적.
    let accountCreated = false;
    try {
      // 1) 로그인 안 된 경우만 — Auth signUp
      if (!isLoggedInUser) {
        const result = await signUp({
          email: form.email,
          password: form.password,
          fullName: form.representativeName,
          phone: form.representativePhone,
          favoriteRegion: '',
        });
        accountCreated = true;
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
      setError(
        accountCreated
          ? '계정은 생성되었지만 신청서 저장에 실패했습니다. 로그인한 뒤 이 페이지에서 다시 신청해주세요.'
          : submitError.message || '신청서를 저장하지 못했습니다. 입력값과 첨부파일을 확인해주세요.',
      );
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
    setResendDone(false);
    setIsResending(true);
    try {
      await resendVerification(form.email);
      setResendDone(true);
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
            현재 <strong>운영팀 서류 검토 대기 중</strong>입니다.
            제출하신 정보와 서류를 검토한 뒤 중개사 이용 권한을 부여합니다.
          </p>
          <ul className="agent-signup-done-list">
            <li>신청 접수만으로 중개사 자격 확인이나 이용 승인이 완료되지는 않습니다</li>
            <li>급매 PRO에서 로그인 후 신청 상태와 검토 사유를 확인할 수 있습니다</li>
            <li>승인 대기 중에는 일반 회원으로 사이트를 이용하실 수 있습니다</li>
          </ul>
          <div className="agent-signup-done-actions">
            <Link to="/agent" className="primary-link-button">신청 상태 확인</Link>
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
              신청서는 접수되었습니다. 인증번호를 입력해 계정의 이메일 인증을 마쳐주세요.
              중개사 자격 확인과 이용 승인은 운영팀의 서류 검토 후 진행됩니다.
            </p>

            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              className="otp-input"
              aria-label="6자리 인증번호"
              placeholder="000000"
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
            />

            {error && <p className="form-status error">{error}</p>}
            {resendDone && !error && (
              <p className="form-status">인증 메일을 다시 보냈습니다. 받은편지함을 확인해주세요.</p>
            )}

            <div className="verification-pending-actions">
              <button
                type="submit"
                className="auth-submit-button"
                disabled={isSubmitting || otpInput.length !== 6}
              >
                {isSubmitting ? '확인 중...' : '이메일 인증번호 확인'}
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
          급매 PRO로 돌아가기
        </Link>

        <div className="agent-signup-heading">
          <h1>중개사 가입 신청</h1>
          <p>
            {isLoggedInUser
              ? '로그인한 계정으로 신청합니다. 제출한 정보와 서류를 운영팀이 검토한 뒤 이용 권한을 부여합니다.'
              : '계정 생성과 중개사 신청을 함께 진행합니다. 이메일 확인이 필요한 경우 다음 단계에서 안내하며, 중개사 이용 승인은 운영팀의 서류 검토 후 진행됩니다.'}
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
                <label className="agent-field">
                  <span>이메일</span>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={updateForm}
                    placeholder="name@example.com"
                    autoComplete="email"
                    required
                  />
                </label>
                <label className="agent-field">
                  <span>비밀번호</span>
                  <input
                    type="password"
                    name="password"
                    value={form.password}
                    onChange={updateForm}
                    placeholder="6자 이상"
                    autoComplete="new-password"
                    minLength={6}
                    required
                  />
                </label>
                <label className="agent-field">
                  <span>비밀번호 확인</span>
                  <input
                    type="password"
                    name="passwordConfirm"
                    value={form.passwordConfirm}
                    onChange={updateForm}
                    placeholder="비밀번호 재입력"
                    autoComplete="new-password"
                    minLength={6}
                    required
                  />
                </label>
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
                <input value={form.email} disabled aria-label="로그인된 계정 이메일" />
              </div>
            </section>
          )}

          <section className="agent-form-section">
            <div>
              <h2>중개사무소 정보</h2>
              <p>중개등록증에 기재된 사무소명과 등록번호를 입력해주세요. 등록 여부는 제출 후 운영팀이 서류로 확인합니다.</p>
            </div>
            <div className="agent-section-controls">
              <label className="agent-field">
                <span>중개사무소명</span>
                <input name="officeName" value={form.officeName} onChange={updateForm} placeholder="예: 급매공인중개사사무소" required />
              </label>
              <label className="agent-field">
                <span>등록번호</span>
                <input name="officeRegistrationNumber" value={form.officeRegistrationNumber} onChange={updateForm} placeholder="예: 11110-2026-00001" required />
              </label>
              <label className="agent-field">
                <span>사무소 주소 <small>(선택)</small></span>
                <input name="officeAddress" value={form.officeAddress} onChange={updateForm} placeholder="예: 서울특별시 마포구 ..." />
              </label>
            </div>
          </section>

          <section className="agent-form-section">
            <div>
              <h2>대표자 정보</h2>
              <p>서류에 기재된 대표자명과 연락 가능한 전화번호를 입력해주세요. 연락처 입력은 휴대폰 본인인증을 의미하지 않습니다.</p>
            </div>
            <div className="agent-section-controls">
              <label className="agent-field">
                <span>대표자명</span>
                <input name="representativeName" value={form.representativeName} onChange={updateForm} placeholder="예: 홍길동" required />
              </label>
              <label className="agent-field">
                <span>대표자 연락처</span>
                <input
                  name="representativePhone"
                  value={form.representativePhone}
                  onChange={updateForm}
                  placeholder="예: 010-1234-5678"
                  inputMode="numeric"
                  maxLength={PHONE_MAX_LENGTH}
                  required
                />
              </label>
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
              <label className="agent-field">
                <span>추가 연락처</span>
                <input
                  name="contactPhone"
                  value={form.contactPhone}
                  onChange={updateForm}
                  placeholder="예: 02-1234-5678"
                  inputMode="numeric"
                  maxLength={PHONE_MAX_LENGTH}
                />
              </label>
            </div>
          </section>

          {error && <p className="form-status error">{error}</p>}

          <button type="submit" className="agent-next-button" disabled={!canSubmit || isSubmitting || !isConfigured}>
            {isSubmitting ? '접수 중...' : isLoggedInUser ? '중개사 신청서 제출' : '계정 만들고 신청서 제출'}
          </button>
        </form>
      </section>
    </div>
  );
}

export default AgentSignup;
