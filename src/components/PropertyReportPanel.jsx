import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Printer, RefreshCw, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { canGenerateReport, fetchPropertyReport, generatePropertyReport } from '../services/propertyReports.js';
import { formatPrice } from '../utils/priceUtils.js';

// document.write 로 들어가는 사용자 입력(매물 타이틀) 이스케이프
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function GradePill({ grade, score }) {
  return (
    <div className="report-grade-pill">
      <strong>{grade}</strong>
      <span>{score} / 100</span>
    </div>
  );
}

function PropertyReportPanel({ property }) {
  const { profile, isAdmin } = useAuth();
  const [state, setState] = useState({ loading: true, report: null, error: null, generating: false });
  const [reloadKey, setReloadKey] = useState(0); // 생성 요청 후 폴링을 다시 시작할 때 올린다
  const reportRef = useRef(null);

  // 다시 생성은 담당 중개사(자기 매물)·운영진만 — Edge Function 도 같은 규칙으로 막는다
  const isOwnListing = profile?.role === 'agent' && Boolean(profile?.email) && property.agent?.email === profile.email;
  const canRegenerate = canGenerateReport && (isAdmin || isOwnListing);

  // 인쇄/PDF — 모달 안이라 CSS 격리가 깨지므로, 새 창에 리포트만 복제해 인쇄
  const handlePrint = () => {
    const node = reportRef.current;
    if (!node) {
      window.print();
      return;
    }
    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) {
      window.print(); // 팝업 차단 시 폴백
      return;
    }
    const cssLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map((el) => `<link rel="stylesheet" href="${el.href}">`)
      .join('');
    const inlineStyles = Array.from(document.querySelectorAll('style'))
      .map((el) => `<style>${el.innerHTML}</style>`)
      .join('');
    win.document.write(
      `<!doctype html><html lang="ko"><head><meta charset="utf-8">`
      + `<title>${escapeHtml(property.title)} — AI 매물 리포트</title>${cssLinks}${inlineStyles}`
      + `<style>body{margin:0;padding:24px;background:#fff;}.report-print-button,.report-regenerate-button{display:none!important;}</style>`
      // 스타일 로드 후 인쇄, 인쇄/취소(afterprint) 시 새 창 자동 닫기
      + `<script>window.onafterprint=function(){window.close();};`
      + `window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>`
      + `</head><body>${node.outerHTML}</body></html>`,
    );
    win.document.close();
    win.focus();
  };

  useEffect(() => {
    let active = true;
    let timer = null;
    setState({ loading: true, report: null, error: null, generating: false });

    const load = () => {
      fetchPropertyReport(property.id)
        .then((data) => {
          if (!active) return;
          // 다른 요청이 생성 중 → 잠시 후 자동 재조회 (폴링)
          if (data?.generating) {
            setState({ loading: false, report: null, error: null, generating: true });
            timer = setTimeout(load, 4000);
            return;
          }
          setState({ loading: false, report: data, error: null, generating: false });
        })
        .catch((err) => {
          if (!active) return;
          setState({ loading: false, report: null, error: err.message, generating: false });
        });
    };
    load();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [property.id, reloadKey]);

  const handleGenerate = async ({ force = false } = {}) => {
    setState((s) => ({ ...s, generating: true, error: null }));
    try {
      const fresh = await generatePropertyReport(property.id, { force });
      if (fresh?.generating) {
        // 다른 요청이 먼저 생성 중 — 폴링으로 완료를 기다린다
        setReloadKey((k) => k + 1);
        return;
      }
      setState({ loading: false, report: fresh, error: null, generating: false });
    } catch (err) {
      setState((s) => ({ ...s, generating: false, error: err.message }));
    }
  };

  if (state.loading) {
    return (
      <div className="property-report loading">
        <Sparkles size={28} />
        <p>AI 리포트를 불러오는 중입니다...</p>
      </div>
    );
  }

  if (state.generating) {
    return (
      <div className="property-report loading">
        <Sparkles size={28} />
        <p>AI 리포트를 생성하고 있습니다...</p>
        <small>완료되면 자동으로 표시됩니다 (10~20초).</small>
      </div>
    );
  }

  // 리포트가 없는 것은 오류가 아니다 — 처음 보는 사람이 버튼을 눌러 만든다 (매물당 1회, 이후는 캐시).
  if (!state.error && !state.report) {
    return (
      <div className="property-report loading">
        <Sparkles size={28} />
        <p>이 매물의 AI 리포트는 아직 만들어지지 않았습니다.</p>
        {canGenerateReport ? (
          <>
            <small>국토부 실거래가·생활권·같은 지역 비교 매물을 바탕으로 AI 가 5개 파트 분석을 작성합니다 (10~20초).</small>
            <button type="button" className="report-action-button" onClick={() => handleGenerate()}>
              <Sparkles size={15} /> AI 리포트 만들기
            </button>
          </>
        ) : (
          <small>로컬 데모 모드에서는 미리 생성한 대표 매물 리포트만 제공합니다. 가격 검증 근거는 가격 리포트에서 확인할 수 있습니다.</small>
        )}
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="property-report error">
        <AlertTriangle size={28} />
        <p>리포트를 만들지 못했습니다.</p>
        {state.error && <small>{state.error}</small>}
        {canGenerateReport && (
          <button type="button" className="report-action-button" onClick={() => handleGenerate()} disabled={state.generating}>
            {state.generating ? '재시도 중...' : '다시 시도'}
          </button>
        )}
      </div>
    );
  }

  const r = state.report.report_data;
  const summary = r.summary ?? {};
  const basic = r.basic ?? {};
  const price = r.priceAnalysis ?? {};
  const loc = r.location ?? {};
  const op = r.opinion ?? {};
  const photo = r.photoAnalysis; // 사진 분석 (사진 첨부된 매물만 존재)

  return (
    <div className="property-report" ref={reportRef}>
      {/* 헤더 — 점수 + 등급 + 매도가 정보 */}
      <header className="report-header">
        <div className="report-header-left">
          <p className="report-eyebrow">AI 매물 리포트</p>
          <h2>{property.title}</h2>
          <p className="report-subtitle">{summary.headline}</p>
        </div>
        <div className="report-header-right">
          <GradePill grade={op.grade ?? '-'} score={op.score ?? 0} />
          <div className="report-pill discount">
            <strong>-{property.discountRate}%</strong>
            <span>실거래가 대비</span>
          </div>
          <div className="report-pill recommendation">
            <strong>{op.buyRecommendation?.toFixed(1) ?? '-'} / 5</strong>
            <span>매수 권장도</span>
          </div>
        </div>
      </header>

      {/* Part 1: 요약 */}
      <section className="report-section">
        <h3>한눈에 보는 요약</h3>
        <div className="report-summary-grid">
          <div className="report-merits">
            <h4><CheckCircle2 size={16} /> 매수 시 핵심 메리트</h4>
            <ul>
              {summary.merits?.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </div>
          <div className="report-cautions">
            <h4><AlertTriangle size={16} /> 주의사항</h4>
            <ul>
              {summary.cautions?.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* Part 2: 기본 정보 + 권리관계 */}
      <section className="report-section">
        <h3>매물 기본 정보 및 권리관계</h3>
        <p>{basic.summaryText}</p>
        <div className="report-note">
          <strong>권리관계:</strong> {basic.rightsAnalysis}
        </div>
      </section>

      {/* Part 3: 가격 분석 (핵심) */}
      <section className="report-section report-section-key">
        <h3>⭐ 가격 분석 — 왜 시세보다 싼가</h3>
        <div className="report-price-grid">
          <div>
            <span>기준 실거래가 (국토부)</span>
            <strong>{formatPrice(property.actualTransactionPrice)}</strong>
          </div>
          <div>
            <span>매도 호가</span>
            <strong>{formatPrice(property.price)}</strong>
          </div>
          <div className="highlight">
            <span>할인 금액</span>
            <strong>
              {property.actualTransactionPrice - property.price > 0
                ? `${formatPrice(property.actualTransactionPrice - property.price)} 저렴`
                : '기준가 이상 (할인 없음)'}
            </strong>
          </div>
        </div>
        <div className="report-text-block">
          <h4>단지 내 가격 경쟁력</h4>
          <p>{price.competitivenessText}</p>
        </div>
        <div className="report-text-block">
          <h4>최근 1년 실거래 추이</h4>
          <p>{price.trendText}</p>
        </div>
        {price.claimCheck && (
          <div className="report-text-block report-claim-check">
            <h4>중개사 주장 검증</h4>
            <p>{price.claimCheck}</p>
          </div>
        )}
        <div className="report-text-block">
          <h4>하방 경직성 — 추가 하락 위험 <em className={`risk-${price.downsideRisk}`}>{price.downsideRisk}</em></h4>
          <p>{price.downsideText}</p>
        </div>
      </section>

      {/* Part 4-1: 사진 기반 컨디션 분석 (사진 첨부된 매물만) */}
      {photo && (
        <section className="report-section">
          <h3>📷 사진 기반 컨디션 분석</h3>
          <p className="report-photo-note">AI가 등록된 매물 사진을 직접 확인해 작성했습니다. 사진에 보이는 것만 기술됩니다.</p>
          {photo.overall && (
            <div className="report-text-block">
              <h4>전반 컨디션</h4>
              <p>{photo.overall}</p>
            </div>
          )}
          {photo.lighting && (
            <div className="report-text-block">
              <h4>채광</h4>
              <p>{photo.lighting}</p>
            </div>
          )}
          {photo.interior && (
            <div className="report-text-block">
              <h4>내부 구조 · 마감</h4>
              <p>{photo.interior}</p>
            </div>
          )}
          {photo.renovation && (
            <div className="report-text-block">
              <h4>리모델링 · 수리 흔적</h4>
              <p>{photo.renovation}</p>
            </div>
          )}
          {photo.concerns && (
            <div className="report-text-block">
              <h4>관찰된 관리 상태 · 주의점</h4>
              <p>{photo.concerns}</p>
            </div>
          )}
        </section>
      )}

      {/* Part 5: 입지 */}
      <section className="report-section">
        <h3>입지 및 지역 흐름</h3>
        <div className="report-location-grid">
          <div>
            <h4>지역 시장 흐름</h4>
            <p>{loc.marketTrend}</p>
          </div>
          <div>
            <h4>교통</h4>
            <p>{loc.transport}</p>
          </div>
          <div>
            <h4>학군</h4>
            <p>{loc.school}</p>
          </div>
          <div>
            <h4>생활편의 및 호재</h4>
            <p>{loc.amenities}</p>
          </div>
        </div>
      </section>

      {/* Part 6: 종합 의견 */}
      <section className="report-section">
        <h3>종합 의견</h3>
        <div className="report-target-buyer">
          <span>이런 분에게 추천</span>
          <strong>{op.targetBuyer}</strong>
        </div>
        <p className="report-final-opinion">{op.finalOpinion}</p>
      </section>

      <footer className="report-footer">
        <small>
          이 리포트는 AI가 생성한 보조 분석으로, 실제 매수 의사결정 전 반드시 직접 확인이 필요합니다.
          {' · '}생성일: {new Date(state.report.generated_at).toLocaleString('ko-KR')}
        </small>
        <div className="report-footer-actions">
          {canRegenerate && (
            <button
              type="button"
              className="report-print-button report-regenerate-button"
              onClick={() => handleGenerate({ force: true })}
              title="최신 실거래 데이터·수정된 매물 정보로 리포트를 새로 작성합니다"
            >
              <RefreshCw size={15} /> 다시 생성
            </button>
          )}
          <button type="button" className="report-print-button" onClick={handlePrint}>
            <Printer size={15} /> 인쇄 · PDF 저장
          </button>
        </div>
      </footer>
    </div>
  );
}

export default PropertyReportPanel;
