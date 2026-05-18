import { useMemo, useState } from 'react';
import { Calculator, UploadCloud } from 'lucide-react';
import SectionTitle from '../components/SectionTitle.jsx';
import {
  calculateDiscountRate,
  calculatePriceGap,
  calculateUrgentScore,
  formatPrice,
  isUrgentSale,
} from '../utils/priceUtils.js';
import { createPropertySubmission } from '../services/propertySubmissions.js';

const initialForm = {
  propertyType: '아파트',
  address: '',
  complexName: '',
  area: '',
  desiredPrice: '',
  recentTransactionPrice: '',
  floor: '',
  builtYear: '',
  moveInDate: '',
  reason: '',
};

function RegisterProperty() {
  const [form, setForm] = useState(initialForm);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submissionSource, setSubmissionSource] = useState(null);

  const result = useMemo(() => {
    const desiredPrice = Number(form.desiredPrice);
    const recentTransactionPrice = Number(form.recentTransactionPrice);
    const discountRate = calculateDiscountRate(desiredPrice, recentTransactionPrice);
    const priceGap = calculatePriceGap(desiredPrice, recentTransactionPrice);
    const urgent = isUrgentSale(desiredPrice, recentTransactionPrice);
    const urgentScore = calculateUrgentScore({
      price: desiredPrice,
      actualTransactionPrice: recentTransactionPrice,
      discountRate,
      verified: true,
      lastVerifiedAt: new Date().toISOString(),
    });

    return { discountRate, priceGap, urgent, urgentScore };
  }, [form.desiredPrice, form.recentTransactionPrice]);

  const updateForm = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    // TODO: 국토부 실거래가 API 연결 시 주소, 단지명, 전용면적으로 최근 실거래가를 자동 조회합니다.
    setIsSubmitting(true);
    setSubmitError('');
    setSubmissionSource(null);

    try {
      const submission = await createPropertySubmission(form, result);
      setSubmissionSource(submission.source);
      setSubmitted(true);
    } catch (error) {
      console.error('Failed to save property submission.', error);
      setSubmitError('Supabase 저장에 실패했습니다. 환경변수와 DB 마이그레이션 적용 상태를 확인하세요.');
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="register-page page-shell">
      <section className="page-hero compact-hero">
        <div className="container">
          <SectionTitle
            eyebrow="매도자 검증"
            title="내 매물 급매 검증하기"
            description="희망 매도가가 최근 실거래가 대비 5% 이상 낮은지 바로 계산합니다."
          />
        </div>
      </section>

      <section className="container form-layout">
        <form className="property-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              매물 유형
              <select name="propertyType" value={form.propertyType} onChange={updateForm}>
                <option>아파트</option>
                <option>오피스텔</option>
                <option>빌라</option>
              </select>
            </label>
            <label>
              주소
              <input name="address" value={form.address} onChange={updateForm} placeholder="예: 서울 서초구 반포동" />
            </label>
            <label>
              단지명
              <input name="complexName" value={form.complexName} onChange={updateForm} placeholder="예: 래미안 원베일리" />
            </label>
            <label>
              전용면적
              <input name="area" value={form.area} onChange={updateForm} placeholder="예: 84" inputMode="numeric" />
            </label>
            <label>
              희망 매도가
              <input
                name="desiredPrice"
                value={form.desiredPrice}
                onChange={updateForm}
                placeholder="원 단위 입력"
                inputMode="numeric"
              />
            </label>
            <label>
              최근 실거래가
              <input
                name="recentTransactionPrice"
                value={form.recentTransactionPrice}
                onChange={updateForm}
                placeholder="원 단위 입력"
                inputMode="numeric"
              />
            </label>
            <label>
              층
              <input name="floor" value={form.floor} onChange={updateForm} placeholder="예: 12층" />
            </label>
            <label>
              준공연도
              <input name="builtYear" value={form.builtYear} onChange={updateForm} placeholder="예: 2018" inputMode="numeric" />
            </label>
            <label>
              입주 가능일
              <input name="moveInDate" value={form.moveInDate} onChange={updateForm} placeholder="예: 즉시 입주 가능" />
            </label>
            <label className="full-span">
              매도 사유
              <textarea
                name="reason"
                value={form.reason}
                onChange={updateForm}
                placeholder="가격 조정 가능성, 매도 희망 시점 등을 입력하세요."
              />
            </label>
          </div>

          <div className="upload-placeholder">
            <UploadCloud size={28} />
            <strong>사진/영상 업로드</strong>
            <span>추후 Supabase Storage 연결 예정</span>
          </div>

          <button type="submit" className="primary-button large" disabled={isSubmitting}>
            <Calculator size={18} />
            {isSubmitting ? '저장 중...' : '급매 여부 계산하기'}
          </button>
          {submissionSource === 'supabase' && (
            <p className="form-status">Supabase에 검증 요청이 저장되었습니다.</p>
          )}
          {submissionSource === 'local' && (
            <p className="form-status">Supabase 환경변수가 없어 화면 계산만 수행했습니다.</p>
          )}
          {submitError && <p className="form-status error">{submitError}</p>}
        </form>

        <aside className="calculation-panel">
          <h2>계산 결과</h2>
          {submitted ? (
            <>
              <div className={result.urgent ? 'result-verdict success' : 'result-verdict'}>
                <strong>{result.urgent ? '급매 기준 충족' : '일반 매물'}</strong>
                <span>
                  실거래가 대비 {result.discountRate}% {result.discountRate >= 0 ? '저렴' : '높음'}
                </span>
              </div>
              <div className="result-grid">
                <div>
                  <span>할인율</span>
                  <strong>{result.discountRate}%</strong>
                </div>
                <div>
                  <span>차액</span>
                  <strong>{formatPrice(result.priceGap)}</strong>
                </div>
              </div>
              <p>
                5% 이상이면 급매 등록 검토가 가능하며, 데이터 부족 시 동일 생활권 유사 면적 기준을 함께 안내합니다.
              </p>
            </>
          ) : (
            <p>희망 매도가와 최근 실거래가를 입력한 뒤 계산하면 결과가 표시됩니다.</p>
          )}
        </aside>
      </section>
    </div>
  );
}

export default RegisterProperty;
