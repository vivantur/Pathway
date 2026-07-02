import type { ReactNode } from 'react';

export interface ChoiceItem {
  id: string;
  name: string;
  description?: string;
  meta?: ReactNode;
}

export function ChoiceGrid({
  items,
  selectedId,
  onSelect,
  columns = 2,
}: {
  items: ChoiceItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  columns?: 1 | 2 | 3;
}) {
  const cols = columns === 1 ? 'sm:grid-cols-1' : columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return (
    <div className={`grid grid-cols-1 gap-3 ${cols}`}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="choice-card text-left"
          data-selected={selectedId === item.id}
          onClick={() => onSelect(item.id)}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-lg text-parchment">{item.name}</span>
            {item.meta}
          </div>
          {item.description && (
            <p className="mt-1 font-ui text-sm leading-snug text-parchment/70">{item.description}</p>
          )}
        </button>
      ))}
    </div>
  );
}
