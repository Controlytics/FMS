import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';

/**
 * FloatInput -- auto-appends .0 on blur for whole numbers.
 * Provides a controlled text input that restricts entry to valid decimal numbers.
 */
export function FloatInput({
  value,
  onValueChange,
  placeholder,
  className,
}: {
  value: any;
  onValueChange: (v: any) => void;
  placeholder?: string;
  className?: string;
}) {
  const fmt = (v: any) => {
    if (v === '' || v === undefined || v === null) return '';
    if (typeof v === 'number' && Number.isInteger(v)) return v.toFixed(1);
    return String(v);
  };
  const [display, setDisplay] = useState(fmt(value));

  useEffect(() => { setDisplay(fmt(value)); }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
          setDisplay(raw);
          onValueChange(raw);
          return;
        }
        if (/^-?\d*\.?\d*$/.test(raw)) {
          setDisplay(raw);
          onValueChange(parseFloat(raw));
        }
      }}
      onBlur={() => {
        if (display !== '' && /^-?\d+$/.test(display)) {
          setDisplay(display + '.0');
        }
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}
