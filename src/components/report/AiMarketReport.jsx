/*
 * AiMarketReport — /report 페이지 하단 AI 시장 분석 카드.
 *
 * props.report: { dataAsOf, generatedAt, model, report: { dataAsOf, marketMood, insights[] } }
 * 입력 없으면 (생성 안 됨) 렌더 X — 페이지가 깔끔하게 빠짐.
 *
 * 면책 라벨은 카드 하단 정적 텍스트 (LLM 출력엔 없음 — 톤 일관성).
 */
import { Sparkles } from 'lucide-react';

const MOOD_LABEL = {
  'premium-dominant': '프리미엄 우세',
  'discount-dominant': '할인 우세',
  mixed: '혼합 양상',
  neutral: '뚜렷한 패턴 없음',
};

function AiMarketReport({ report }) {
  if (!report?.report?.insights?.length) return null;

  const { dataAsOf } = report;
  const { marketMood, insights } = report.report;

  return (
    <section className="container ai-market-section">
      <article className="ai-market-card">
        <header className="ai-market-header">
          <div>
            <span className="ai-market-eyebrow">
              <Sparkles size={14} aria-hidden="true" />
              AI 시장 분석
            </span>
            <h2>{dataAsOf} 시장 진단</h2>
          </div>
          {marketMood && MOOD_LABEL[marketMood] && (
            <span className={`ai-market-mood mood-${marketMood}`}>
              {MOOD_LABEL[marketMood]}
            </span>
          )}
        </header>

        <ul className="ai-market-insights">
          {insights.map((insight, idx) => (
            <li key={`${insight.title}-${idx}`} className="ai-market-insight">
              {insight.sourceArea && (
                <span className="ai-market-insight-source">{insight.sourceArea}</span>
              )}
              <h3>{insight.title}</h3>
              <p>{insight.body}</p>
              {insight.supportNumbers?.length > 0 && (
                <div className="ai-market-insight-numbers">
                  {insight.supportNumbers.map((n, i) => (
                    <span key={i}>{n}</span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        <p className="ai-market-disclaimer">
          본 분석은 {dataAsOf} 기준 국토부 실거래가 통계에 근거한 패턴 진단입니다.
          정보 제공 목적이며 매수·매도 권유나 미래 가격 예측이 아닙니다.
          투자 의사결정은 본인 책임 하에 진행하시기 바랍니다.
        </p>
      </article>
    </section>
  );
}

export default AiMarketReport;
