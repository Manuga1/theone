import type { ReactNode, CSSProperties } from 'react';

export type CardProps = {
  title?: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
  flat?: boolean;
  soft?: boolean;
  tight?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onClick?: () => void;
};

export function Card({ title, sub, right, footer, flat, soft, tight, className = '', style, children, onClick }: CardProps) {
  const cls = ['card', flat && 'card--flat', soft && 'card--soft', tight && 'card--tight', className].filter(Boolean).join(' ');
  return (
    <section className={cls} style={style} onClick={onClick}>
      {(title || right) && (
        <header className="card__head">
          <div>
            {title && <div className="card__title">{title}</div>}
            {sub && <div className="card__sub">{sub}</div>}
          </div>
          {right}
        </header>
      )}
      {children}
      {footer && <footer className="card__foot">{footer}</footer>}
    </section>
  );
}
