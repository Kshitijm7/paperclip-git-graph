export function CompareSelect({ trunk, branches, onChange }: { trunk: string; branches: string[]; onChange: (branch: string) => void }) {
  const options = branches.includes(trunk) ? branches : [trunk, ...branches];
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }} title="Ahead and behind counts compare each branch with this one">
      <span className="gg-dim" style={{ fontSize: 12, whiteSpace: "nowrap" }}>Compare with</span>
      <select className="gg-input" style={{ maxWidth: 220 }} value={trunk} onChange={(e) => onChange(e.target.value)}>
        {options.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </label>
  );
}
