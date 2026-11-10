// Value-kind glyphs (the finite data types from the founder notes): continuous / float / boolean / text / one_time / categorical / file / photo.
import { TrendingUp, Hash, ToggleLeft, Type, History, Tag, FileText, Camera } from 'lucide-react';
import type { ValueKind } from '@shared/api-types';

export const VALUE_KIND_LABEL: Record<ValueKind, string> = {
  continuous: 'Continuous series',
  float: 'Number',
  boolean: 'Yes / no',
  text: 'Free text',
  one_time: 'Updatable fact',
  categorical: 'Category',
  file: 'File',
  photo: 'Photo',
};

export function valueKindIcon(kind: ValueKind) {
  switch (kind) {
    case 'continuous': return <TrendingUp />;
    case 'float': return <Hash />;
    case 'boolean': return <ToggleLeft />;
    case 'text': return <Type />;
    case 'one_time': return <History />;
    case 'categorical': return <Tag />;
    case 'file': return <FileText />;
    case 'photo': return <Camera />;
  }
}

export function ValueKindGlyph({ kind, title }: { kind: ValueKind | undefined; title?: string }) {
  if (!kind) return null;
  return <span className="vk" title={title ?? VALUE_KIND_LABEL[kind]} aria-label={VALUE_KIND_LABEL[kind]} role="img">{valueKindIcon(kind)}</span>;
}
