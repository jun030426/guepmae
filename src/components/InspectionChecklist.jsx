import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  canGenerateInspection,
  fetchPropertyInspection,
  generatePropertyInspection,
} from '../services/propertyInspections.js';

const STATUS_CLASS = {
  양호: 'is-good',
  주의: 'is-warn',
  '확인 불가': 'is-unknown',
};

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

/*
 * InspectionChecklist — 매물 사진 기반 AI 점검 체크리스트.
 * 사진에 안 보이는 항목은 '확인 불가'로 정직하게 표기하는 것이 원칙.
 * 생성 버튼은 중개사(자기 매물)·운영진에게만 보인다.
 */
export default function InspectionChecklist({ property }) {
  const { profile, isAdmin } = useAuth();
  const [inspection, setInspection] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    fetchPropertyInspection(property.id)
      .then((next) => {
        if (!active) return;
        setInspection(next);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [property.id]);

  const isOwnListing = profile?.role === 'agent' && property.agent?.email === profile?.email;
  const canGenerate = canGenerateInspection && (isAdmin || isOwnListing);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError('');
    try {
      const report = await generatePropertyInspection(property.id);
      if (report) {
        setInspection({ report, generatedAt: new Date().toISOString(), photoCount: null });
        const refreshed = await fetchPropertyInspection(property.id);
        if (refreshed) setInspection(refreshed);
      }
    } catch (generateError) {
      setError(generateError.message || '점검 리포트 생성에 실패했습니다.');
    } finally {
      setIsGenerating(false);
    }
  };

  const report = inspection?.report;

  return (
    <div className="inspection-panel">
      {isLoading ? (
        <p className="inspection-empty">점검 리포트를 확인하는 중입니다…</p>
      ) : report ? (
        <>
          <div className="inspection-head">
            <span className={`inspection-grade ${STATUS_CLASS[report.grade === '양호' ? '양호' : report.grade === '주의 필요' ? '주의' : '확인 불가'] ?? 'is-unknown'}`}>
              {report.grade}
            </span>
            <p className="inspection-summary">{report.summary}</p>
          </div>
          <ul className="inspection-list">
            {report.items.map((item) => (
              <li key={item.category} className="inspection-item">
                <div className="inspection-item-head">
                  <strong>{item.category}</strong>
                  <span className={`inspection-status ${STATUS_CLASS[item.status] ?? 'is-unknown'}`}>{item.status}</span>
                </div>
                <p className="inspection-finding">{item.finding}</p>
                <p className="inspection-action">현장 확인 — {item.action}</p>
              </li>
            ))}
          </ul>
          <p className="inspection-meta">
            등록 사진 {inspection.photoCount ?? '-'}장 기준 AI 분석 · {formatDate(inspection.generatedAt)} 생성 ·
            사진에 보이지 않는 항목은 &lsquo;확인 불가&rsquo;로 표기합니다. 계약 전 현장 확인을 대체하지 않습니다.
          </p>
        </>
      ) : (
        <p className="inspection-empty">
          아직 이 매물의 점검 리포트가 없습니다.
          {canGenerate ? ' 등록된 사진으로 바로 생성할 수 있습니다.' : ' 중개사가 사진을 분석해 제공할 예정입니다.'}
        </p>
      )}

      {canGenerate && (
        <div className="inspection-actions">
          <button type="button" className="inspection-generate" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? 'AI가 사진을 분석하는 중… (10~30초)' : report ? '점검 리포트 다시 생성' : 'AI 점검 리포트 생성'}
          </button>
          {error && <p className="form-status error">{error}</p>}
        </div>
      )}
    </div>
  );
}
