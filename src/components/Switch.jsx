export function Switch({ label, hint, checked, onChange, disabled }) {
  return (
    <div className="config-item">
      <div className="config-info">
        <span className="config-label">{label}</span>
        {hint && <span className="config-subtext">{hint}</span>}
      </div>
      <label className="switch">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="slider"></span>
      </label>
    </div>
  );
}
