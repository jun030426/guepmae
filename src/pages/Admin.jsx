import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Building2, CheckCircle2, ClipboardCheck, Crown, ExternalLink, FileText, Lock, ShieldCheck, Users, X, XCircle } from 'lucide-react';
import SectionTitle from '../components/SectionTitle.jsx';
import StatCard from '../components/StatCard.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useProperties } from '../hooks/useProperties.js';
import { setPropertyVerified } from '../services/propertyRegistration.js';
import {
  ROLE_LABEL,
  allowedNewRoles,
  canChangeRole,
  canToggleSuspend,
  fetchAllProfiles,
  setUserRole,
  setUserSuspended,
} from '../services/userManagement.js';
import {
  approveAgentApplication,
  fetchAgentApplications,
  getApplicationDocumentUrl,
  rejectAgentApplication,
} from '../services/agentApplications.js';
import { formatPrice } from '../utils/priceUtils.js';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js';

const APPLICATION_STATUS_LABEL = {
  pending: '대기 중',
  reviewing: '검토 중',
  approved: '승인됨',
  rejected: '거부됨',
};

const ROLE_ORDER = ['owner', 'admin', 'agent', 'user'];

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// 중개사 가입 신청 상세 모달
function AgentApplicationModal({ application, onClose, onApprove, onReject, isUpdating }) {
  const [docUrls, setDocUrls] = useState({});

  useEffect(() => {
    const docs = application.document_paths ?? [];
    docs.forEach((doc) => {
      getApplicationDocumentUrl(doc.path).then((url) => {
        setDocUrls((prev) => ({ ...prev, [doc.path]: url }));
      }).catch(() => {});
    });
  }, [application]);

  const rows = [
    ['중개사무소명', application.office_name],
    ['사업자등록번호', application.office_registration_number],
    ['사무소 주소', application.office_address || '-'],
    ['대표자명', application.representative_name],
    ['대표자 연락처', application.representative_phone],
    ['연락 이메일', application.contact_email],
    ['추가 연락처', application.contact_phone || '-'],
    ['신청일', new Date(application.created_at).toLocaleString('ko-KR')],
    ['현재 상태', APPLICATION_STATUS_LABEL[application.status] ?? application.status],
  ];

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="admin-modal-header">
          <h2>중개사 가입 신청 상세</h2>
          <button type="button" className="admin-modal-close" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </header>

        <div className="admin-modal-body">
          <table className="admin-modal-table">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {application.document_paths?.length > 0 && (
            <div className="admin-modal-docs">
              <h3>첨부 문서</h3>
              <ul>
                {application.document_paths.map((doc) => (
                  <li key={doc.path}>
                    <strong>{doc.label === 'business-registration' ? '사업자등록증' : doc.label === 'broker-license' ? '공인중개사 자격증' : doc.label}</strong>
                    {' — '}
                    {docUrls[doc.path] ? (
                      <a href={docUrls[doc.path]} target="_blank" rel="noopener noreferrer">
                        {doc.originalName} 보기
                      </a>
                    ) : (
                      <span>로딩 중...</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {application.reviewer_note && (
            <div className="admin-modal-note">
              <strong>운영팀 메모:</strong> {application.reviewer_note}
            </div>
          )}
        </div>

        <footer className="admin-modal-footer">
          {(application.status === 'pending' || application.status === 'reviewing') ? (
            <>
              <button
                type="button"
                className="admin-approve-button"
                disabled={isUpdating}
                onClick={onApprove}
              >
                <CheckCircle2 size={14} /> 승인
              </button>
              <button
                type="button"
                className="admin-reject-button"
                disabled={isUpdating}
                onClick={onReject}
              >
                <XCircle size={14} /> 거부
              </button>
            </>
          ) : (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
              이미 {APPLICATION_STATUS_LABEL[application.status]} 처리된 신청입니다.
            </p>
          )}
        </footer>
      </div>
    </div>
  );
}

function Admin() {
  const { properties } = useProperties();
  const { profile: currentActor } = useAuth();
  const [updating, setUpdating] = useState(null);
  const [error, setError] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [applications, setApplications] = useState([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [activeApp, setActiveApp] = useState(null); // 상세 모달 표시용

  useEffect(() => {
    let active = true;
    fetchAllProfiles()
      .then((data) => active && setProfiles(data))
      .catch((err) => active && setError(`사용자 목록 로드 실패: ${err.message}`))
      .finally(() => active && setProfilesLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetchAgentApplications()
      .then((data) => active && setApplications(data))
      .catch((err) => active && setError(`중개사 신청 목록 로드 실패: ${err.message}`))
      .finally(() => active && setAppsLoading(false));
    return () => { active = false; };
  }, []);

  const pendingApplications = applications.filter((a) => a.status === 'pending' || a.status === 'reviewing');

  const handleApproveApplication = async (app) => {
    if (!confirm(`${app.office_name} 신청을 승인하시겠습니까?\n해당 이메일(${app.contact_email})로 가입된 사용자에게 중개사 권한이 부여됩니다.`)) return;
    setUpdating(app.id);
    try {
      const result = await approveAgentApplication(app);
      alert(result.message);
      setApplications((prev) => prev.map((a) => (a.id === app.id ? { ...a, status: 'approved' } : a)));
      // 프로필 목록도 갱신
      const fresh = await fetchAllProfiles();
      setProfiles(fresh);
      setActiveApp(null);
    } catch (err) {
      setError(`승인 실패: ${err.message}`);
    } finally {
      setUpdating(null);
    }
  };

  const handleRejectApplication = async (app) => {
    const note = prompt('거부 사유 (선택 — 신청자에게 안내):') ?? null;
    if (!confirm(`${app.office_name} 신청을 거부하시겠습니까?`)) return;
    setUpdating(app.id);
    try {
      await rejectAgentApplication(app.id, note);
      setApplications((prev) => prev.map((a) => (a.id === app.id ? { ...a, status: 'rejected', reviewer_note: note } : a)));
      setActiveApp(null);
    } catch (err) {
      setError(`거부 실패: ${err.message}`);
    } finally {
      setUpdating(null);
    }
  };

  const groupedProfiles = profiles.reduce((acc, p) => {
    const role = p.role || 'user';
    acc[role] = acc[role] || [];
    acc[role].push(p);
    return acc;
  }, {});

  const handleRoleChange = async (target, newRole) => {
    if (target.role === newRole) return;
    if (!canChangeRole(currentActor, target, newRole)) {
      setError('이 권한 변경을 수행할 수 없습니다.');
      return;
    }
    if (!confirm(`이 사용자의 권한을 ${ROLE_LABEL[target.role]} → ${ROLE_LABEL[newRole]} 로 변경하시겠습니까?`)) return;
    setUpdating(target.id);
    try {
      await setUserRole(target.id, newRole);
      setProfiles((prev) => prev.map((p) => (p.id === target.id ? { ...p, role: newRole } : p)));
    } catch (err) {
      setError(`권한 변경 실패: ${err.message}`);
    } finally {
      setUpdating(null);
    }
  };

  const handleSuspendToggle = async (target) => {
    if (!canToggleSuspend(currentActor, target)) {
      setError('이 사용자를 정지/해제할 수 없습니다.');
      return;
    }
    const action = target.suspended ? '정지 해제' : '정지';
    if (!confirm(`이 사용자(${target.email})를 ${action}하시겠습니까?`)) return;
    setUpdating(target.id);
    try {
      await setUserSuspended(target.id, !target.suspended);
      setProfiles((prev) => prev.map((p) => (p.id === target.id ? { ...p, suspended: !target.suspended } : p)));
    } catch (err) {
      setError(`${action} 실패: ${err.message}`);
    } finally {
      setUpdating(null);
    }
  };

  // 미검증 매물 (verified=false) — 운영팀 승인 대기 큐
  const pendingProperties = properties.filter((p) => !p.verified);
  const verifiedCount = properties.filter((p) => p.verified).length;

  const handleApprove = async (id) => {
    setUpdating(id);
    setError('');
    try {
      await setPropertyVerified(id, true);
      // 로컬 즉시 반영 (실제 다음 fetch까지 캐시 유지)
      setRefreshTick((t) => t + 1);
      window.location.reload(); // 간단하게 reload — useProperties 가 재페치
    } catch (err) {
      setError(`승인 실패: ${err.message}`);
      setUpdating(null);
    }
  };

  const handleReject = async (id, title) => {
    if (!confirm(`정말로 "${title}" 매물을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setUpdating(id);
    setError('');
    try {
      const { data, error: delError } = await supabase
        .from('properties')
        .delete()
        .eq('id', id)
        .select('id');
      if (delError) throw delError;
      if (!data || data.length === 0) {
        throw new Error('권한이 없거나 매물이 존재하지 않아 삭제되지 않았습니다.');
      }
      window.location.reload();
    } catch (err) {
      setError(`반려/삭제 실패: ${err.message}`);
      setUpdating(null);
    }
  };

  return (
    <div className="admin-page page-shell">
      <section className="page-hero compact-hero">
        <div className="container">
          <SectionTitle
            eyebrow="관리자"
            title="급매 운영 대시보드"
            description="매물 승인, 신고 처리, 검증 로그를 한 화면에서 관리합니다."
          />
        </div>
      </section>

      <section className="container admin-stat-grid">
        <StatCard
          icon={Building2}
          label="승인 대기 매물"
          value={`${pendingProperties.length}건`}
          description="중개사 등록 후 검토 필요"
          tone="accent"
        />
        <StatCard
          icon={ClipboardCheck}
          label="검증 완료 매물"
          value={`${verifiedCount}건`}
          description="플랫폼 전체 노출 중"
        />
        <StatCard
          icon={FileText}
          label="중개사 가입 신청"
          value={`${pendingApplications.length}건`}
          description="검토 대기 중"
          tone={pendingApplications.length > 0 ? 'accent' : undefined}
        />
        <StatCard
          icon={Users}
          label="중개사"
          value={`${(groupedProfiles.agent ?? []).length}명`}
          description="매물 등록 권한 보유"
        />
      </section>

      {error && (
        <section className="container">
          <p className="form-status error">{error}</p>
        </section>
      )}

      {/* ----------------------------- 중개사 가입 신청 ----------------------------- */}
      <section className="container admin-grid">
        <div className="admin-panel wide">
          <div className="admin-panel-header">
            <h2>중개사 가입 신청 ({pendingApplications.length})</h2>
            <span>승인 시 신청 이메일과 매칭되는 사용자에게 중개사 권한이 자동 부여됩니다</span>
          </div>
          {appsLoading ? (
            <p className="admin-empty">불러오는 중...</p>
          ) : pendingApplications.length === 0 ? (
            <p className="admin-empty">대기 중인 신청이 없습니다.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>중개사무소</th>
                    <th>대표자</th>
                    <th>연락처</th>
                    <th>이메일</th>
                    <th>신청일</th>
                    <th>액션</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingApplications.map((app) => (
                    <tr key={app.id}>
                      <td>
                        <button
                          type="button"
                          className="admin-link admin-app-link"
                          onClick={() => setActiveApp(app)}
                        >
                          {app.office_name}
                          <FileText size={12} />
                        </button>
                      </td>
                      <td>{app.representative_name}</td>
                      <td>{app.representative_phone}</td>
                      <td>{app.contact_email}</td>
                      <td>{formatDate(app.created_at)}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="admin-approve-button"
                            disabled={updating === app.id}
                            onClick={() => handleApproveApplication(app)}
                          >
                            <CheckCircle2 size={14} />
                            {updating === app.id ? '처리 중...' : '승인'}
                          </button>
                          <button
                            type="button"
                            className="admin-reject-button"
                            disabled={updating === app.id}
                            onClick={() => handleRejectApplication(app)}
                          >
                            <XCircle size={14} />
                            거부
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="container admin-grid">
        <div className="admin-panel wide">
          <div className="admin-panel-header">
            <h2>매물 승인 대기 ({pendingProperties.length})</h2>
            <span>중개사가 등록한 새 매물 — 승인하면 일반 사이트에 "검증 완료" 라벨로 노출됨</span>
          </div>
          {pendingProperties.length === 0 ? (
            <p className="admin-empty">승인 대기 중인 매물이 없습니다.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>매물명</th>
                    <th>지역</th>
                    <th>매도가</th>
                    <th>할인율</th>
                    <th>등록일</th>
                    <th>액션</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingProperties.map((property) => (
                    <tr key={property.id}>
                      <td>
                        <Link to={`/properties/${property.id}`} className="admin-link" target="_blank">
                          {property.title}
                          <ExternalLink size={12} />
                        </Link>
                      </td>
                      <td>{property.region}</td>
                      <td>{formatPrice(property.price)}</td>
                      <td>{property.discountRate}%</td>
                      <td>{property.lastVerifiedAt}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="admin-approve-button"
                            disabled={updating === property.id}
                            onClick={() => handleApprove(property.id)}
                          >
                            <CheckCircle2 size={14} />
                            {updating === property.id ? '처리 중...' : '승인'}
                          </button>
                          <button
                            type="button"
                            className="admin-reject-button"
                            disabled={updating === property.id}
                            onClick={() => handleReject(property.id, property.title)}
                          >
                            <XCircle size={14} />
                            반려
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="admin-panel wide">
          <div className="admin-panel-header">
            <h2>검증 완료 매물 ({verifiedCount}건)</h2>
            <span>현재 사이트에 노출 중인 매물</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>매물명</th>
                  <th>지역</th>
                  <th>매도가</th>
                  <th>할인율</th>
                  <th>액션</th>
                </tr>
              </thead>
              <tbody>
                {properties.filter((p) => p.verified).slice(0, 10).map((property) => (
                  <tr key={property.id}>
                    <td>
                      <Link to={`/properties/${property.id}`} className="admin-link" target="_blank">
                        {property.title}
                        <ExternalLink size={12} />
                      </Link>
                    </td>
                    <td>{property.region}</td>
                    <td>{formatPrice(property.price)}</td>
                    <td>{property.discountRate}%</td>
                    <td>
                      <button
                        type="button"
                        className="admin-revoke-button"
                        disabled={updating === property.id}
                        onClick={async () => {
                          if (!confirm(`"${property.title}" 검증을 취소(노출 중단)하시겠습니까?`)) return;
                          setUpdating(property.id);
                          try {
                            await setPropertyVerified(property.id, false);
                            window.location.reload();
                          } catch (err) {
                            setError(`검증 취소 실패: ${err.message}`);
                            setUpdating(null);
                          }
                        }}
                      >
                        검증 취소
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ----------------------------- 사용자 관리 ----------------------------- */}
      <section className="container admin-grid">
        {ROLE_ORDER.map((role) => {
          const list = groupedProfiles[role] ?? [];
          return (
            <div key={role} className="admin-panel wide">
              <div className="admin-panel-header">
                <h2>
                  {role === 'owner' && <Crown size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />}
                  {ROLE_LABEL[role]} ({list.length}명)
                </h2>
                <span>
                  {role === 'owner' && '플랫폼 최상위 권한 — 모든 관리자/중개사/회원 관리 가능'}
                  {role === 'admin' && '운영팀 — 중개사/회원 권한 관리 + 매물 승인'}
                  {role === 'agent' && '매물 등록 권한 보유'}
                  {role === 'user' && '일반 가입자 — 매물 조회/문의만 가능'}
                </span>
              </div>
              {profilesLoading ? (
                <p className="admin-empty">불러오는 중...</p>
              ) : list.length === 0 ? (
                <p className="admin-empty">해당 권한의 사용자가 없습니다.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>이메일</th>
                        <th>이름</th>
                        <th>연락처</th>
                        <th>가입일</th>
                        <th>상태</th>
                        <th>액션</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((p) => {
                        const isSelf = currentActor?.id === p.id;
                        const allowed = allowedNewRoles(currentActor, p);
                        const canSuspend = canToggleSuspend(currentActor, p);
                        return (
                          <tr key={p.id} className={p.suspended ? 'is-suspended' : ''}>
                            <td>{p.email || '-'}{isSelf && <span className="self-badge">나</span>}</td>
                            <td>{p.full_name || '-'}</td>
                            <td>{p.phone || '-'}</td>
                            <td>{formatDate(p.created_at)}</td>
                            <td>
                              {p.suspended ? (
                                <span className="suspended-badge"><Lock size={11} /> 정지됨</span>
                              ) : (
                                <span className="active-badge">정상</span>
                              )}
                            </td>
                            <td>
                              <div className="admin-row-actions">
                                {allowed.length > 0 ? (
                                  <select
                                    className="admin-role-select"
                                    value={p.role || 'user'}
                                    disabled={updating === p.id}
                                    onChange={(e) => handleRoleChange(p, e.target.value)}
                                  >
                                    <option value={p.role}>{ROLE_LABEL[p.role]}</option>
                                    {allowed
                                      .filter((r) => r !== p.role)
                                      .map((r) => (
                                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                                      ))}
                                  </select>
                                ) : (
                                  <span className="admin-no-permission">권한 변경 불가</span>
                                )}
                                {canSuspend && (
                                  <button
                                    type="button"
                                    className={p.suspended ? 'admin-approve-button' : 'admin-reject-button'}
                                    disabled={updating === p.id}
                                    onClick={() => handleSuspendToggle(p)}
                                  >
                                    {p.suspended ? '정지 해제' : '정지'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {activeApp && (
        <AgentApplicationModal
          application={activeApp}
          onClose={() => setActiveApp(null)}
          onApprove={() => handleApproveApplication(activeApp)}
          onReject={() => handleRejectApplication(activeApp)}
          isUpdating={updating === activeApp.id}
        />
      )}
    </div>
  );
}

export default Admin;
