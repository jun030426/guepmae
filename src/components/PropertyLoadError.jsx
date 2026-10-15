export default function PropertyLoadError({ onRetry }) {
  return (
    <div className="empty-state" role="alert">
      <p>매물을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
      {onRetry && <button type="button" className="outline-button" onClick={onRetry}>다시 불러오기</button>}
    </div>
  );
}
