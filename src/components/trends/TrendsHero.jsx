/*
 * TrendsHero — /trends 페이지 상단 Hero
 *
 * /report Hero와 같은 .page-hero · .compact-hero · .report-hero-grid · .report-source-meta
 * 클래스를 그대로 재사용 (스타일 분리는 추후 CSS 정리 단계에서 결정).
 *
 * props.lastYearMonth: 시계열의 마지막 달 (예: '2026-05'). 로딩 중엔 '—' 표시.
 */
import { Database } from 'lucide-react';
import SectionTitle from '../SectionTitle.jsx';

function TrendsHero({ lastYearMonth }) {
  return (
    <section className="page-hero compact-hero">
      <div className="container report-hero-grid">
        <SectionTitle
          eyebrow="시장 데이터"
          title="시세 동향"
          description="구·시·군 + 평형대로 13개월 실거래 추이를 확인합니다."
        />
        <div className="report-source-meta">
          <Database size={15} />
          <div>
            <strong>국토교통부 실거래가</strong>
            <span>
              데이터 기준 {lastYearMonth ?? '—'} · 공개 지연으로 최근월은 변동 가능
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export default TrendsHero;
