import { Search } from 'lucide-react';

export function SearchBar({ value, onChange, onSubmit, placeholder = 'Search variables, populations, or studies', width }: { value: string; onChange: (v: string) => void; onSubmit?: (v: string) => void; placeholder?: string; width?: number }) {
  return (
    <label className="search" style={width ? { width } : undefined}>
      <Search />
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit?.(value);
        }}
      />
    </label>
  );
}
