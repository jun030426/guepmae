import { useEffect, useId, useRef, useState } from 'react';
import { db } from '../lib/dataClient.js';

// 단지명 자동완성 — complex_prices 에서 실제 단지를 검색해 선택하게 함.
// 선택 시 onSelect({ complex, gu, sigungu }) 로 구/시군구까지 함께 전달 (기준가 매칭용).
// 콤보박스 패턴: ↑↓ 로 이동, Enter 선택, Esc 닫기.
function ComplexAutocomplete({ value, onChange, onSelect, name, placeholder, required }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const skipSearch = useRef(false);
  const boxRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return undefined;
    }
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return undefined;
    }
    let active = true;
    const timer = setTimeout(async () => {
      const { data, error } = await db
        .from('complex_prices')
        .select('complex, sigungu, gu, built_year')
        .ilike('complex', `%${q}%`)
        .limit(40);
      if (!active) return;
      if (error) {
        // 검색 실패 — 조용히 목록만 닫는다 (직접 입력 폴백은 그대로 동작)
        setSuggestions([]);
        setOpen(false);
        return;
      }
      const seen = new Set();
      const deduped = [];
      for (const row of data ?? []) {
        const key = `${row.complex}|${row.gu}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(row);
        if (deduped.length >= 8) break;
      }
      setSuggestions(deduped);
      setActiveIndex(-1);
      setOpen(deduped.length > 0);
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    const onDocMouseDown = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const pick = (s) => {
    skipSearch.current = true; // 선택으로 인한 value 변경은 재검색 안 함
    onSelect(s);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event) => {
    if (!open || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0) {
        event.preventDefault();
        pick(suggestions[activeIndex]);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="complex-autocomplete" ref={boxRef}>
      <input
        type="text"
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        required={required}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
      />
      {open && (
        <ul className="complex-suggestions" role="listbox" id={listId}>
          {suggestions.map((s, index) => (
            <li
              key={`${s.complex}|${s.gu}`}
              id={`${listId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'is-active' : undefined}
              onMouseDown={() => pick(s)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <strong>{s.complex}</strong>
              <span>{s.sigungu}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ComplexAutocomplete;
