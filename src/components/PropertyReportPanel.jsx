import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import { fetchPropertyReport, regeneratePropertyReport } from '../services/propertyReports.js';
import { formatPrice } from '../utils/priceUtils.js';

function GradePill({ grade, score }) {
  return (
    <div className="report-grade-pill">
      <strong>{grade}</strong>
      <span>{score} / 100</span>
    </div>
  );
}

function PropertyReportPanel({ property }) {
  const [state, setState] = useState({ loading: true, report: null, error: null, generating: false });

  useEffect(() => {
    let active = true;
    setState({ loading: true, report: null, error: null, generating: false });
    fetchPropertyReport(property.id)
      .then((data) => {
        if (!active) return;
        setState({ loading: false, report: data, error: null, generating: false });
      })
      .catch((err) => {
        if (!active) return;
        setState({ loading: false, report: null, error: err.message, generating: false });
      });
    return () => { active = false; };
  }, [property.id]);

  const handleRegenerate = async () => {
    setState((s) => ({ ...s, generating: true, error: null }));
    try {
      const fresh = await regeneratePropertyReport(property.id);
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
        <small>첫 생성 시 10~20초 소요됩니다.</small>
      </div>
    );
  }

  if (state.error || !state.report) {
    return (
      <div className="property-report error">
        <AlertTriangle size={28} />
        <p>리포트를 불러오지 못했습니다.</p>
        {state.error && <small>{state.error}</small>}
        <button type="button" className="report-action-button" onClick={handleRegenerate} disabled={state.generating}>
          {state.generating ? '재시도 중...' : '다시 시도'}
        </button>
      </div>
    );
  }

  const r = state.report.report_data;
  const summary = r.summary ?? {};
  const basic = r.basic ?? {};
  const price = r.priceAnalysis ?? {};
  const loc = r.location ?? {};
  const op = r.opinion ?? {};

  return (
    <div className="property-report">
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
            <strong>-{price.discountPct?.toFixed(1) ?? 0}%</strong>
            <span>시세 대비</span>
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
            <span>AI 적정시세 (VAI)</span>
            <strong>{formatPrice(price.vaiPrice ?? 0)}</strong>
          </div>
          <div>
            <span>매도 호가</span>
            <strong>{formatPrice(property.price)}</strong>
          </div>
          <div className="highlight">
            <span>할인 금액</span>
            <strong>{formatPrice(price.discountAmount ?? 0)} 저렴</strong>
          </div>
        </div>
        <div className="report-text-block">
          <h4>단지 내 가격 경쟁력</h4>
          <p>{price.competitivenessText}</p>
        </div>
        <div className="report-text-block">
          <h4>최근 가격 추이</h4>
          <p>{price.trendText}</p>
        </div>
        <div className="report-text-block">
          <h4>하방 경직성 — 추가 하락 위험 <em className={`risk-${price.downsideRisk}`}>{price.downsideRisk}</em></h4>
          <p>{price.downsideText}</p>
        </div>
      </section>

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
      </footer>
    </div>
  );
}

export default PropertyReportPanel;
