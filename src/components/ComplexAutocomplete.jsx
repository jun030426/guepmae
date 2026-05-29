import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

// 단지명 자동완성 — complex_prices 에서 실제 단지를 검색해 선택하게 함.
// 선택 시 onSelect({ complex, gu, sigungu }) 로 구/시군구까지 함께 전달 (기준가 매칭용).
function ComplexAutocomplete({ value, onChange, onSelect, name, placeholder, required }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const skipSearch = useRef(false);
  const boxRef = useRef(null);

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
      const { data } = await supabase
        .from('complex_prices')
        .select('complex, sigungu, gu')
        .ilike('complex', `%${q}%`)
        .limit(40);
      if (!active) return;
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
  };

  return (
    <div className="complex-autocomplete" ref={boxRef}>
      <input
        type="text"
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        required={required}
      />
      {open && (
        <ul className="complex-suggestions">
          {suggestions.map((s) => (
            <li key={`${s.complex}|${s.gu}`} onMouseDown={() => pick(s)}>
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
