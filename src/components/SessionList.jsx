import { useMemo, useState } from "react";

const SORTS = {
  date_desc: { label: "Newest first", cmp: (a, b) => sortDate(b) - sortDate(a) },
  date_asc: { label: "Oldest first", cmp: (a, b) => sortDate(a) - sortDate(b) },
  title_asc: { label: "Title A→Z", cmp: (a, b) => a.title.localeCompare(b.title) },
  msgs_desc: { label: "Most messages", cmp: (a, b) => b.messages.length - a.messages.length },
  msgs_asc: { label: "Fewest messages", cmp: (a, b) => a.messages.length - b.messages.length },
};

function sortDate(s) {
  const ts = s.endedAt || s.startedAt || s.date;
  return ts ? new Date(ts).getTime() || 0 : 0;
}

export function SessionList({ sessions, selected, onToggle, onToggleAll, onSelect, onBulkDownload, onClear }) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState("date_desc");

  const filteredSorted = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let list = sessions;
    if (f) {
      list = list.filter((s) => {
        const hay = `${s.title} ${s.fileName || ""} ${s.date || ""}`.toLowerCase();
        return hay.includes(f);
      });
    }
    const cmp = SORTS[sortKey]?.cmp || SORTS.date_desc.cmp;
    return [...list].sort(cmp);
  }, [sessions, filter, sortKey]);

  return (
    <div style={{ animation: "fadeIn 0.3s ease", marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <h3 style={{ color: "#f8fafc", margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
          Found {sessions.length} Session{sessions.length === 1 ? "" : "s"}
          <button
            onClick={onToggleAll}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#94a3b8",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {selected.size === filteredSorted.length && filteredSorted.length > 0 ? "Deselect All" : "Select All"}
          </button>
        </h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {selected.size > 0 && (
            <button className="btn-primary btn-success" onClick={onBulkDownload} style={{ fontSize: 13, padding: "8px 16px" }}>
              💾 Download {selected.size} as .zip
            </button>
          )}
          <button
            className="btn-secondary"
            onClick={onClear}
            style={{
              fontSize: 13,
              padding: "8px 16px",
              background: "rgba(255,255,255,0.1)",
              border: "none",
              color: "#e2e8f0",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title, file, or date…"
          style={{
            flex: 1,
            minWidth: 200,
            padding: "8px 12px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#e2e8f0",
            borderRadius: 6,
            fontSize: 13,
          }}
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          style={{
            padding: "8px 12px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#e2e8f0",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k} style={{ background: "#0f172a" }}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto", paddingRight: 8 }}>
        {filteredSorted.length === 0 && (
          <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 24 }}>
            No sessions match the current filter.
          </div>
        )}
        {filteredSorted.map((sess) => {
          const idx = sessions.indexOf(sess);
          return (
            <div
              key={idx}
              className="session-list-item"
              onClick={() => onSelect(sess)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                padding: "12px 16px",
                borderRadius: 8,
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
            >
              <input
                type="checkbox"
                checked={selected.has(idx)}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggle(idx);
                }}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#6366f1" }}
              />
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: "0 0 6px", color: "#e2e8f0", fontSize: 15 }}>{sess.title}</h4>
                <div style={{ fontSize: 12, color: "#94a3b8", display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>📅 {sess.date || "Unknown date"}</span>
                  <span>💬 {sess.messages.length} messages</span>
                  <span style={{ color: "#475569" }}>📄 {sess.fileName}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
